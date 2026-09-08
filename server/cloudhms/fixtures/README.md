# CloudHMS contract fixtures

Các file JSON ở đây được trích từ response mẫu trong bộ Postman collection CloudHMS đã duyệt
(`CiHMS Booking Engine.postman_collection.json`, trích ngày 2026-08-16). Chúng **giữ nguyên tên
field và cấu trúc lồng nhau** của upstream; chỉ cắt bớt phần tử thừa và các trường mô tả
(description, ảnh, điện thoại, email, toạ độ) không được mapper sử dụng.

Không sửa các file này bằng tay để test pass. Nếu mapper không đọc được fixture thì mapper sai,
không phải fixture sai.

Các fixture `booking-create.json`, `booking-guarantees.json`, `booking-confirm.json` và
`booking-inventory.json` được trích ngày 2026-09-08 từ response đầu tiên của `(1) Create booking`,
`(2.1) Get guarantee methods`, `(3.1) Batch Commit Booking`, `Get hotel availability` trong cùng collection.
Chỉ giữ các trường cần cho hợp đồng, bỏ thông tin khách. Inventory giữ cặp phòng/rate
`5051e26c…` / `1604924a…` và các allotment thật. Guarantee giữ đủ 5 ngày có cùng method ID:
đây là các khoản theo ngày, không phải 5 phương thức độc lập. Commit gửi mỗi ID một lần.

Fixture có nhãn **Live capture** được chụp từ tenant staging thật bằng `npm run check:cloudhms`.
Khi đổi tenant hoặc CloudHMS đổi hợp đồng, chụp lại chứ đừng chỉnh tay.

| File | Nguồn | Ghi chú |
|---|---|---|
| `hotels-info.json` | `Property Service/Get hotels` | Giữ nguyên envelope thật `total: 50, limit: 30` cho request `limit=50` — bằng chứng CloudHMS tự giới hạn page size. Item `VinOasis Phú Quốc` được thêm từ payload `get-hotel-availability` để id khớp giữa catalog và availability |
| `room-type.json` | `Property Service/Get list room type` | Envelope `total: 19, limit: 100` |
| `hotel-availability.json` | `Booking Service/Get hotel availability` | Giữ **một rate `totalAmount = 0`** và **một rate có giá**. Mẫu gốc có 15/360 rate 0 đồng kèm `quantity > 0` |
| `room-detail-availability.json` | `Booking Service/Get room detail availability` | Nguyên trạng, chỉ bỏ `packages`. Chú ý: **không có `totalTaxAmount`**, `rates[]` **không có `taxAmount`**, `roomType` **không có `name`** (chỉ `roomTypeID`), `quantity: 0` dù rate vẫn hợp lệ |
| `room-availability.json` | **Live capture** `api.beta.cloudhms.io`, property `5751`, 2026-08-29 | Thay cho shape suy diễn cũ (vốn dựng theo envelope của `get-hotel-availability` và **sai hoàn toàn**). Giữ nguyên ba điểm của payload thật: `roomTypeId` / `ratePlanId` cấp một là **GUID toàn số 0**, ID dùng được nằm ở `roomType.roomTypeID` và `ratePlan.ratePlanId`; `roomType` dùng `roomTypeName` / `roomTypeCode` chứ không phải `name` / `code`; `totalAmount` lồng **hai** tầng còn `averageAmount` và `totalTaxAmount` lồng một tầng. Đã bỏ `description`, `extends`, `packages`, `allotments`, policy và bớt thumbnails |
