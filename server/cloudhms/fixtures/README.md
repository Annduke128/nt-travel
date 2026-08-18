# CloudHMS contract fixtures

Các file JSON ở đây được trích từ response mẫu trong bộ Postman collection CloudHMS đã duyệt
(`CiHMS Booking Engine.postman_collection.json`, trích ngày 2026-08-16). Chúng **giữ nguyên tên
field và cấu trúc lồng nhau** của upstream; chỉ cắt bớt phần tử thừa và các trường mô tả
(description, ảnh, điện thoại, email, toạ độ) không được mapper sử dụng.

Không sửa các file này bằng tay để test pass. Nếu mapper không đọc được fixture thì mapper sai,
không phải fixture sai.

| File | Nguồn | Ghi chú |
|---|---|---|
| `hotels-info.json` | `Property Service/Get hotels` | Giữ nguyên envelope thật `total: 50, limit: 30` cho request `limit=50` — bằng chứng CloudHMS tự giới hạn page size. Item `VinOasis Phú Quốc` được thêm từ payload `get-hotel-availability` để id khớp giữa catalog và availability |
| `room-type.json` | `Property Service/Get list room type` | Envelope `total: 19, limit: 100` |
| `hotel-availability.json` | `Booking Service/Get hotel availability` | Giữ **một rate `totalAmount = 0`** và **một rate có giá**. Mẫu gốc có 15/360 rate 0 đồng kèm `quantity > 0` |
| `room-detail-availability.json` | `Booking Service/Get room detail availability` | Nguyên trạng, chỉ bỏ `packages`. Chú ý: **không có `totalTaxAmount`**, `rates[]` **không có `taxAmount`**, `roomType` **không có `name`** (chỉ `roomTypeID`), `quantity: 0` dù rate vẫn hợp lệ |
| `room-availability.json` | ⚠️ **shape suy ra** | Mẫu `Get room availability` trong collection trả `roomAvailabilityRates: []`. File này dựng theo envelope inner-rate của `get-hotel-availability` (cùng cấu trúc `rateAvailablity`) cộng `propertyInfo` thật. **Phải xác nhận bằng smoke live** (`SMOKE_DUMP_SHAPE=1`) rồi khoá lại theo shape thật |
