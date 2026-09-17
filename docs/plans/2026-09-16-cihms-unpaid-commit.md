> Trạng thái: **đã triển khai mục 1, 2, 4, 5** (2026-09-17). Payload commit chưa thanh toán đã kiểm chứng trên CiHMS test.
> Còn chờ: profileRefID của NT_Travel từ CiHMS, Requestor ID chính thức, thêm `CLOUDHMS_TRAVEL_AGENT_*` vào `.env.example`.
> Mục 3 (script đọc ngược) chưa làm. E2E qua `CloudHmsBookingGateway` đã sửa: 5751237588 → Reserved, payment No, settled 0, TravelAgent NT_Travel.

# Sửa commit booking CiHMS: không ghi nhận thanh toán + gắn profile NT_Travel

## Context

NT Travel không thu tiền, nhưng sau bước xác nhận CiHMS ghi reservation là `paymentStatus=Complete`, `guaranteeType=Credit`.
Booking cũng chưa gắn profile NT_Travel. Mục tiêu: reservation `Reserved`, CiHMS ghi **chưa thanh toán**,
có profile **TravelAgent NT_Travel**, và có cách đọc ngược từ API CiHMS để chứng minh.

## Bằng chứng trên tenant test

Tenant: identity `identity.stg.hulk.cloudhms.io`, CRS `api.beta.cloudhms.io`, org `vingroup`, property `5751`,
channel `7e504b27-9a93-49af-8ccf-d73da1f778a8` (dc code `NT_Travel`). Đọc lại bằng `POST /common-trd/v1/crs/reservation/search-free-text`.

| Confirmation | Tạo bởi | Commit body | status | paymentStatus | guaranteeType | requestAmount | settledAmount |
|---|---|---|---|---|---|---|---|
| 5751237213, 5751237237 | App hiện tại | `guaranteeMethods: [{ id }]` | Reserved | **Complete** | **Credit** | 0 | 0 |
| 5751237586 (1 đêm) | Thử nghiệm | `guaranteeInfos` (xem dưới) | Reserved | **No** | **No** | 2.700.000 | 0 |
| 5751237587 (2 đêm, full flow) | Thử nghiệm | `guaranteeInfos` (xem dưới) | Reserved | **No** | **No** | 5.400.000 | 0 |

Payload chạy được (5751237587, 2 dòng method theo ngày cùng một `id`, gửi một lần):

```json
{ "items": [{ "reservationId": "<id>", "guaranteeInfos": [
    { "guaranteePolicyId": "<guaranteeMethods[].id>", "guaranteeRefID": "<guaranteeMethods[].detail.id>" }
  ] }], "isSendMail": false, "organization": "vingroup" }
```

CiHMS lưu lại `guaranteeInfos[{ guaranteeName: Deposit, guaranteeType: GuaranteeRequired, guaranteeMethod: Cash, guaranteeValue: "0" }]`.

Các biến thể **bị từ chối** trên 5751237586 (reservation vẫn `Prospect` sau mỗi lần):

| guaranteePolicyId | guaranteeRefID | Thêm | Kết quả |
|---|---|---|---|
| `detail.id` | `detail.id` | `guaranteeValue: 0` | 400, message chung chung |
| `detail.id` | `detail.id` | `guaranteeValue: 0`, `guaranteeMethod: Cash`, `guaranteeType`, `guaranteeName` | 400, message chung chung |
| `detail.id` | method `id` | `guaranteeValue: 0` | 400, message chung chung |
| `detail.id` | `detail.id` | — | 400 `Guarantee Policy ID 00000001-… is invalid` |

**Profile:** gửi `{ profileType: "TravelAgent", firstName: "NT_Travel", taCode: "NT_Travel", profileRefID: "" }` →
CiHMS lưu TravelAgent tên `NT_Travel` nhưng `profileRefID` rỗng, `taCode` rỗng: **không liên kết** tới profile nào.
Collection không có API tra profile; tìm reservation theo "NT_Travel" trả 0 kết quả. Cần CiHMS cung cấp profileRefID.

**Phát hiện thêm:** `referenceIds[Opera_TA_Rec_Loc]` bị CiHMS cắt còn 35 ký tự. Ví dụ app gửi `NT-b8e9435a-f7b7-4fa6-9875-7bdab4e2b…` (39 ký tự),
CiHMS chỉ lưu `NT-b8e9435a-f7b7-4fa6-9875-7bdab4e2b`, nên mã đối soát `NT-{requestId}` trong app không khớp chính xác với CiHMS.

**Lưu ý client:** `CloudHmsClient` quy mọi lỗi (kể cả 400 có `errorMessages` cụ thể) về `UPSTREAM_UNAVAILABLE`, nên lỗi hợp đồng bị che.

## Thay đổi

Làm theo TDD: test đỏ trước.

### 1. Commit không ghi nhận thanh toán
- `shared/contracts.ts`: thêm `policyRefId: string` vào `BookingGuarantee.methods[]` (giá trị `detail.id`).
- `server/cloudhms/bookings.ts`
  - `parseBookingGuarantee`: đọc `policyRefId = identifier(object(row.detail).id)`; thiếu thì `throw invalid()`.
  - `confirm`: thay `guaranteeMethods` bằng `guaranteeInfos`, mỗi method `id` duy nhất một phần tử
    `{ guaranteePolicyId: method.id, guaranteeRefID: method.policyRefId }`; **không gửi `guaranteeValue`**. Comment ngắn dẫn lý do:
    `guaranteeMethods` bị CiHMS ghi là Complete/Credit.
- `server/bookings/mock.ts`: thêm `policyRefId` cho method demo.
- `server/cloudhms/fixtures/booking-guarantees.json`: trích lại từ `(2.1) Get guarantee methods` giữ `detail.id`; cập nhật `fixtures/README.md`.
  (Chưa làm) fixture **Live capture** batch-commit của 5751237587: parser hiện không đọc `paymentStatus` nên chưa cần.

### 2. Gắn profile TravelAgent NT_Travel
- `server/config.ts`: `CLOUDHMS_TRAVEL_AGENT_NAME` (mặc định `NT_Travel`) và `CLOUDHMS_TRAVEL_AGENT_PROFILE_ID` (tùy chọn).
  Chưa có ID thì gửi tên với `profileRefID: ""` (đã kiểm chứng: lưu tên nhưng không liên kết).
- `bookings.ts`: thêm `{ firstName, profileRefID, profileType: "TravelAgent" }` sau Booker.
- `.env.example`: thêm 2 biến.

### 3. Script đọc ngược reservation (chỉ đọc)
- `server/cloudhms/reservation-check.ts` + `check:cloudhms:reservation` / `:production` theo khuôn `connectivity.ts`.
  Gọi `search-free-text` theo confirmation number; in status, paymentStatus, guaranteeType, requestAmount, settledAmount,
  guaranteeInfos, profiles `{ type, ref }` (tên chỉ với TravelAgent/Company). Không in thông tin khách.
  Bản nháp đã chạy được: scratchpad `probe.ts` của phiên 2026-09-17.

### 4. Test
- `bookings.test.ts`: confirm gửi `guaranteeInfos` đúng shape, gộp method trùng `id`, không có `guaranteeMethods`/`guaranteeValue`;
  parse `policyRefId`; từ chối method thiếu `detail.id`; prepare có profile TravelAgent.
- `config.test.ts`: cấu hình profile TravelAgent.
- `service.test.ts:15`: thêm `policyRefId` vào fixture.

### 5. Tài liệu
- `docs/cihms-integration.md` Step 4 (commit bằng `guaranteeInfos`, profile TravelAgent), bảng cấu hình.
- `docs/operations-runbook.md`: bảng env, *Booking operations*, mục contract questions ghi kết quả **[verified 2026-09-17]**.
- `docs/customer-uat.md`: dòng kiểm tra "CiHMS ghi chưa thanh toán và có TravelAgent NT_Travel".

## Ngoài phạm vi (ghi nhận để làm riêng)
- Mã tham chiếu bị cắt 35 ký tự: rút gọn reference (ví dụ `NT-` + 32 hex không gạch) để đối soát khớp.
- `CloudHmsClient` che lỗi 400 của CiHMS: cân nhắc map 4xx có `errorMessages` sang `BOOKING_REJECTED`.
- Reservation đã bị ghi Complete/Credit (5751237213, 5751237237 và các đơn khác từ channel NT_Travel): vận hành xử lý trên CiHMS.
- Reservation thử nghiệm 5751237586, 5751237587, 5751237588: hủy trên CiHMS khi không cần nữa.

## Hash điều kiện bảo đảm
Thêm `policyRefId` đổi `version`: đơn `created` đang mở lúc deploy báo `GUARANTEE_CHANGED` một lần, nhân viên tải lại là xong.

## Verification
1. `npm run check` pass.
2. Staging: tạo + xác nhận 1 booking qua app → `npm run check:cloudhms:reservation -- <confirmation>`:
   `status=Reserved`, `paymentStatus=No`, `guaranteeType=No`, `settledAmount=0`, `requestAmount` = tổng bảo đảm,
   profiles có `TravelAgent` với ref đã cấu hình.
3. Hủy reservation thử.
