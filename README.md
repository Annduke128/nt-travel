# NT Travel Bedbank

Ứng dụng nội bộ để nhân viên NT Travel tìm phòng, xem giá net và chính sách, tạo và xác nhận đặt phòng qua CiHMS.

Luồng đặt phòng: **Tìm phòng → Xem hạng phòng → Đặt phòng → Nhập khách → Tạo đặt phòng → Đọc điều kiện bảo đảm → Xác nhận đặt phòng**.
Mục **Đặt phòng của tôi** hiển thị 100 yêu cầu gần nhất do nhân viên đang đăng nhập tạo qua ứng dụng, có tìm theo mã, khách sạn và khách.
Mỗi phòng cần một khách đại diện. Hiện hỗ trợ tối đa 8 phòng có cùng số khách, tối đa 30 đêm; chưa hỗ trợ cập nhật/hủy hoặc tìm booking được tạo bên ngoài ứng dụng.

Live cần áp dụng migration `supabase/migrations/202609080001_bookings.sql` trước khi chạy bản mới. Booking live được lưu bền vững trong Supabase; mock dùng bộ nhớ và hiển thị nhãn thử nghiệm.
Xem [hướng dẫn tích hợp CiHMS](docs/cihms-integration.md) để biết thứ tự API và xử lý lỗi.

## Chạy local

1. Dùng Node theo `.nvmrc`, chạy `npm ci`, sau đó sao chép `.env.example` thành `.env` và điền cấu hình Supabase. Giữ `CLOUDHMS_MODE=mock` khi chưa có API credentials. Server tự nạp `.env` khi `NODE_ENV` khác `production`; production nhận biến từ secret store và không đóng gói `.env`.
2. Chạy migration bằng `supabase db reset`.
3. Tạo Admin đầu tiên (lệnh có thể chạy lại):

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=admin@example.com npm run bootstrap:admin
   ```

   Mật khẩu được nhập ẩn qua stdin, không truyền trên command line.
4. Mở hai terminal: `npm run dev:server` và `npm run dev`.

Vite proxy `/api` sang BFF tại `127.0.0.1:3001`. Production dùng image từ `Dockerfile`; Node phục vụ cả API và frontend build cùng domain. Xem [runbook production](docs/operations-runbook.md) và [checklist UAT](docs/customer-uat.md).
Kết quả production-readiness local gần nhất nằm tại [validation report](docs/validation-report-2026-07-25.md).

## Bật CloudHMS live

Điền toàn bộ biến `CLOUDHMS_*` trong secret store, đặc biệt organization ID thật (khác organization code `Vingroup`). Server live sẽ từ chối khởi động nếu thiếu identifier/secret bắt buộc.

Smoke test chỉ đọc dữ liệu:

```bash
CLOUDHMS_MODE=live \
SMOKE_DESTINATION='Nha Trang' \
SMOKE_ARRIVAL_DATE=2026-08-10 \
SMOKE_DEPARTURE_DATE=2026-08-12 \
npm run smoke:cloudhms
```

Log CloudHMS chỉ gồm endpoint, latency, status và correlation ID; không log token, password hay raw response body.

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:server
```

Hoặc chạy toàn bộ release gate:

```bash
npm run check
```

Health endpoints:

- `/health/live`: tiến trình đang sống.
- `/health/ready`: Supabase và CloudHMS sẵn sàng phục vụ.
