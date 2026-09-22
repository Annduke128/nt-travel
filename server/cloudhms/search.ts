import Fuse, { type IFuseOptions } from "fuse.js";
import type { NoAvailabilityDetails, PropertyDto, SearchRequest } from "../contracts.js";
import { AppError } from "../errors.js";

// Nhân viên gõ "Tây Ninh" nhưng catalog lưu "Hotel Tay Ninh 11" (và ngược lại với "Phú Quốc"),
// nên so khớp điểm đến phải bỏ dấu ở cả hai phía. CiHMS còn viết liên từ không nhất quán
// ("Resort và Spa Đà Nẵng" nhưng "Resort & Spa Phú Quốc Oasis"), nên `&` phải quy về "va" ở cả
// hai phía, nếu không nửa danh mục biến mất khi nhân viên gõ dấu "&".
const normalize = (value: string): string =>
  value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
    .replace(/&/g, " va ").replace(/\s+/g, " ").trim();

// Catalog CiHMS có lỗi chính tả của chính nó ("Vinpear Discovery" thiếu chữ "l") và nhân viên
// thường gõ thiếu từ giữa tên ("vinpearl hai phong" ↔ "Vinpearl Hotel Imperia Hải Phòng"), nên
// so khớp chuỗi con không đủ. Extended search của Fuse coi khoảng trắng là AND và khớp mờ từng
// token, đúng cách nhân viên gõ.
type CatalogEntry = { property: PropertyDto; haystack: string };

// Ký tự điều khiển của cú pháp extended search (`!` phủ định, `^`/`$` neo đầu-cuối, `|` hoặc,
// `=` khớp tuyệt đối, `'` khớp nguyên văn). Ô tìm kiếm nhận tên khách sạn chứ không nhận query,
// nên phải loại bỏ thay vì để người dùng vô tình đảo ngược phép lọc.
const EXTENDED_OPERATORS = /['!^$|=]/g;

// Token ngắn mà vẫn cho sai một ký tự thì "hue" khớp luôn "phu": tìm khách sạn Huế nhận về
// mọi khách sạn Phú Quốc. Dưới ngưỡng này token phải khớp nguyên văn (toán tử `'` của extended
// search), từ đủ dài mới được chịu lỗi chính tả.
const EXACT_TOKEN_LENGTH = 4;

const FUSE_OPTIONS: IFuseOptions<CatalogEntry> = {
  keys: ["haystack"],
  useExtendedSearch: true,
  ignoreLocation: true,
  // 0.35 là ngưỡng chịu được đúng một lỗi ký tự trên token ~8 chữ ("vinpearl" ↔ "vinpear")
  // mà chưa kéo theo khách sạn khác thương hiệu.
  threshold: 0.35,
};

// Số khách sạn đã khớp tên gửi kèm lỗi NO_AVAILABILITY; bằng giới hạn gợi ý để không đẩy cả
// catalog vào payload lỗi.
const MATCHED_DETAIL_LIMIT = 20;

// ISO → dd/MM/yyyy cho thông điệp nhân viên đọc. Tách chuỗi thay vì dựng Date để không lệch
// một ngày khi server chạy ở UTC.
const stayLabel = (value: string): string => {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};

export type PropertyMatcher = (query: string) => PropertyDto[];

/**
 * Chỉ mục khớp mờ dùng chung cho gợi ý (`/api/properties`) và kết quả tìm kiếm
 * (`/api/availability/hotels`), ở cả live và mock — hai màn hình không được lệch tập khớp, và
 * mock-mode phải phản ánh đúng hành vi live để deployment mock còn test được cái gì.
 */
export function createPropertyMatcher(properties: PropertyDto[]): PropertyMatcher {
  const entries = properties.map((property): CatalogEntry => ({ property, haystack: normalize(`${property.name} ${property.city}`) }));
  const index = new Fuse(entries, FUSE_OPTIONS);
  return (query) => {
    const tokens = normalize(query).replace(EXTENDED_OPERATORS, " ").split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return properties;
    const pattern = tokens.map((token) => token.length < EXACT_TOKEN_LENGTH ? `'${token}` : token).join(" ");
    return index.search(pattern).map((hit) => hit.item.property);
  };
}

// Hai nguyên nhân "không có kết quả" phải tách nhau: sai tên thì sửa tên, còn khớp tên mà hết
// phòng thì đổi ngày. Trả `[]` cho cả hai khiến nhân viên đi sửa nhầm tiêu chí.
export const propertyNotFound = (destination: string): AppError =>
  new AppError(404, "PROPERTY_NOT_FOUND", `Không có khách sạn nào khớp với “${destination}”`);

export const noAvailability = (destination: string, search: SearchRequest, matches: PropertyDto[]): AppError =>
  new AppError(404, "NO_AVAILABILITY",
    `${matches.length} khách sạn khớp “${destination}” nhưng không còn phòng từ ${stayLabel(search.arrivalDate)} đến ${stayLabel(search.departureDate)}`,
    { properties: matches.slice(0, MATCHED_DETAIL_LIMIT) } satisfies NoAvailabilityDetails);
