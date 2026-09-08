import "../env.js";
import { CloudHmsClient } from "./client.js";
import { loadConfig } from "../config.js";

// Chẩn đoán kết nối CloudHMS theo từng tầng. Khác `smoke.ts`: script này không fail-fast và
// không coi "không còn phòng" là lỗi, nên phân biệt được sai credential / token bị CRS từ chối /
// sai distribution channel / hết phòng — bốn thứ mà `CloudHmsClient` đều quy về AppError(503).

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
// CloudHMS lồng số tiền tới hai tầng ({ amount: { amount, currencyCode } }); đi sâu giống
// `nestedAmount` trong bedbank.ts, nếu không mọi rate đều bị đọc nhầm thành 0.
function nestedAmount(value: unknown): number {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "number") return current;
    current = object(current).amount;
  }
  return 0;
}

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

const PATH = {
  catalog: "/common-trd/v1/pms-property/hotels/info",
  roomType: "/common-trd/v1/pms-property/room-type",
  hotelAvailability: "/common-trd/v1/crs/booking/get-hotel-availability",
  roomAvailability: "/common-trd/v1/crs/booking/get-room-availability",
  roomDetail: "/common-trd/v1/crs/booking/get-room-detail-availability",
} as const;

type StepStatus = "pass" | "fail" | "skip";
type Step = { id: string; name: string; status: StepStatus; httpStatus?: number; detail: RecordValue };

const steps: Step[] = [];
function record(id: string, name: string, status: StepStatus, detail: RecordValue, httpStatus?: number): void {
  const step: Step = { id, name, status, ...(httpStatus === undefined ? {} : { httpStatus }), detail };
  steps.push(step);
  console.info(JSON.stringify(step));
}

// `CloudHmsClient` chuyển mọi phản hồi lỗi thành AppError(503) không kèm status/body thật. Client
// nhận `fetcher` qua constructor nên chỉ cần bọc `fetch` là lấy được nguyên nhân gốc, không phải
// sửa production code. Body đọc trên bản `clone()` vì stream chỉ tiêu thụ được một lần.
type Trace = { status: number; url: string; body: string };
let lastTrace: Trace | undefined;
const tracingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  lastTrace = { status: response.status, url: response.url, body: response.ok ? "" : (await response.clone().text()).slice(0, 500) };
  return response;
};

// Bọc trong hàm để TypeScript dùng kiểu khai báo thay vì thu hẹp thành `undefined` sau mỗi
// lần reset ở phạm vi module.
function resetTrace(): void { lastTrace = undefined; }
// `client.request` gọi `acquireToken()` trước, và call token cũng đi qua tracingFetch. Chỉ nhận
// trace của đúng endpoint đang đo, nếu không status 200 của identity sẽ che status thật.
function traceOf(path: string): Trace | undefined {
  const [endpoint] = path.split("?");
  return lastTrace && endpoint && lastTrace.url.includes(endpoint) ? lastTrace : undefined;
}
function traceStatus(path: string): number | undefined { return traceOf(path)?.status; }

function fail(id: string, name: string, error: unknown, path: string): void {
  const detail: RecordValue = { error: error instanceof Error ? error.message : String(error) };
  const trace = traceOf(path);
  if (!trace) {
    // Không có phản hồi nào cho chính endpoint này: fetch ném trước khi có status — timeout
    // (CLOUDHMS_TIMEOUT_MS) hoặc lỗi mạng, không phải upstream trả lỗi.
    detail.reason = "Không nhận được phản hồi HTTP (timeout hoặc lỗi mạng)";
    record(id, name, "fail", detail);
    return;
  }
  if (trace.body) detail.upstreamBody = trace.body;
  record(id, name, "fail", detail, trace.status);
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- S0: cấu hình

const config = loadConfig();
if (config.cloudHms.mode !== "live") throw new Error("Chẩn đoán chỉ chạy khi CLOUDHMS_MODE=live");

const propertyId = process.env.SMOKE_PROPERTY_ID ?? "";
const arrivalDate = process.env.SMOKE_ARRIVAL_DATE ?? isoDate(30);
const departureDate = process.env.SMOKE_DEPARTURE_DATE ?? isoDate(32);
const adults = Number(process.env.SMOKE_ADULTS ?? 2) || 2;
const occupancy = {
  numberOfAdult: adults,
  otherOccupancies: [
    { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: 0 },
    { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: 0 },
  ],
};

record("S0", "Cấu hình", "pass", {
  identityUrl: config.cloudHms.identityUrl,
  apiUrl: config.cloudHms.apiUrl,
  clientId: `${config.cloudHms.clientId.slice(0, 8)}…`,
  clientSecret: "***",
  organizationId: config.cloudHms.organizationId,
  organizationCode: config.cloudHms.organizationCode,
  distributionChannelId: config.cloudHms.distributionChannelId,
  timeoutMs: config.cloudHms.timeoutMs,
  propertyId: propertyId || "(chưa đặt SMOKE_PROPERTY_ID)",
  arrivalDate, departureDate, adults,
});

// -------------------------------------------------------- S1: identity /connect/token

// Gọi thẳng fetch thay vì qua client: cần status HTTP và body lỗi thật của identity server.
let tokenOk = false;
try {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.cloudHms.clientId,
    client_secret: config.cloudHms.clientSecret,
    organization_id: config.cloudHms.organizationId,
  });
  const response = await fetch(`${config.cloudHms.identityUrl}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(config.cloudHms.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    record("S1", "Identity /connect/token", "fail", { upstreamBody: text.slice(0, 500) }, response.status);
  } else {
    const payload = object(JSON.parse(text));
    const accessToken = string(payload.access_token);
    if (!accessToken) {
      record("S1", "Identity /connect/token", "fail", { reason: "Không có access_token", keys: Object.keys(payload) }, response.status);
    } else {
      // Chỉ in claim chẩn đoán, không bao giờ in chính token. `iss`/`aud` là bằng chứng cho việc
      // token của identity stg có dùng được cho CRS beta hay không.
      const segment = accessToken.split(".")[1];
      let claims: RecordValue = {};
      if (segment) {
        try { claims = object(JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))); } catch { claims = {}; }
      }
      const exp = number(claims.exp);
      record("S1", "Identity /connect/token", "pass", {
        tokenType: string(payload.token_type),
        expiresIn: number(payload.expires_in),
        iss: claims.iss ?? null,
        aud: claims.aud ?? null,
        clientIdClaim: claims.client_id ?? null,
        scope: claims.scope ?? payload.scope ?? null,
        expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
        otherClaimKeys: Object.keys(claims).filter((key) => !["iss", "aud", "exp", "client_id", "scope"].includes(key)),
      }, response.status);
      tokenOk = true;
    }
  }
} catch (error) {
  fail("S1", "Identity /connect/token", error, "/connect/token");
}

const client = new CloudHmsClient(config.cloudHms, tracingFetch);

// ------------------------------------------------- S2: catalog /pms-property/hotels/info

let catalogItems: RecordValue[] = [];
let resolvedPropertyId = propertyId;
if (!tokenOk) {
  record("S2", "Catalog hotels/info", "skip", { reason: "S1 chưa lấy được token" });
} else {
  try {
    resetTrace();
    const payload = await client.request<unknown>(`${PATH.catalog}?page=0&limit=200`, { method: "GET" });
    const data = object(object(payload).data);
    catalogItems = array(data.items).map(object);
    const match = catalogItems.find((item) => string(item.id) === propertyId);
    // Mapper hiện chỉ đọc id/name/city/status; property code (5751) chưa rõ nằm ở khoá nào nên
    // dò trên toàn bộ khoá cấp một của item để chốt tên trường thật.
    const byCode = catalogItems.find((item) => Object.values(item).some((value) => String(value) === "5751"));
    record("S2", "Catalog hotels/info", "pass", {
      total: number(data.total), limitTraGiaThucTe: number(data.limit), itemCount: catalogItems.length,
      itemKeys: catalogItems[0] ? Object.keys(catalogItems[0]) : [],
      propertyFoundById: Boolean(match),
      propertyStatus: match ? match.status ?? null : null,
      propertyName: match ? string(match.name) : null,
      propertyCity: match ? string(match.city) : null,
      activeCount: catalogItems.filter((item) => item.status === true || item.status === 1).length,
      code5751Field: byCode ? Object.keys(byCode).find((key) => String(byCode[key]) === "5751") ?? null : null,
      code5751MatchesPropertyId: byCode ? string(byCode.id) === propertyId : false,
    }, traceStatus(PATH.catalog));
    if (!match && byCode) resolvedPropertyId = string(byCode.id);
  } catch (error) {
    fail("S2", "Catalog hotels/info", error, PATH.catalog);
  }
}

// --------------------------------------------------- S3: /pms-property/room-type

const canQueryProperty = tokenOk && Boolean(resolvedPropertyId);
if (!canQueryProperty) {
  record("S3", "Room type metadata", "skip", { reason: tokenOk ? "Không xác định được propertyId" : "S1 chưa lấy được token" });
} else {
  try {
    resetTrace();
    const payload = await client.request<unknown>(`${PATH.roomType}?hotelId=${encodeURIComponent(resolvedPropertyId)}&isPseudo=false`, { method: "GET" });
    const data = object(object(payload).data);
    const items = array(data.items ?? object(payload).data).map(object);
    record("S3", "Room type metadata", "pass", {
      count: items.length,
      itemKeys: items[0] ? Object.keys(items[0]) : [],
      roomTypes: items.slice(0, 10).map((item) => ({ id: string(item.id), name: string(item.name, string(item.code)) })),
    }, traceStatus(PATH.roomType));
  } catch (error) {
    fail("S3", "Room type metadata", error, PATH.roomType);
  }
}

// ------------------------------------------ S4: crs/booking/get-hotel-availability

// Org code chỉ khác nhau chữ hoa/thường giữa yêu cầu của khách (`vingroup`) và mặc định trong
// `.env.example` (`Vingroup`). Khi upstream từ chối bằng 4xx, thử đúng một lần với casing đảo lại
// để chốt giá trị nào được chấp nhận thay vì đoán.
const altOrganizationCode = config.cloudHms.organizationCode === config.cloudHms.organizationCode.toLowerCase()
  ? config.cloudHms.organizationCode.charAt(0).toUpperCase() + config.cloudHms.organizationCode.slice(1)
  : config.cloudHms.organizationCode.toLowerCase();
let workingOrganizationCode = config.cloudHms.organizationCode;

async function availability(path: string, extra: RecordValue): Promise<unknown> {
  const send = (organization: string) => client.request<unknown>(path, { body: {
    arrivalDate, departureDate, numberOfRoom: 1,
    distributionChannelId: config.cloudHms.distributionChannelId,
    roomOccupancy: occupancy, organization, ...extra,
  } });
  try {
    return await send(workingOrganizationCode);
  } catch (error) {
    if (workingOrganizationCode === altOrganizationCode || !lastTrace || lastTrace.status < 400 || lastTrace.status >= 500) throw error;
    const result = await send(altOrganizationCode);
    workingOrganizationCode = altOrganizationCode;
    return result;
  }
}

let hotelRates: RecordValue[] = [];
if (!canQueryProperty) {
  record("S4", "get-hotel-availability", "skip", { reason: tokenOk ? "Không xác định được propertyId" : "S1 chưa lấy được token" });
} else {
  try {
    resetTrace();
    const payload = await availability(PATH.hotelAvailability, { propertyIds: [resolvedPropertyId] });
    const entries = array(object(object(payload).data).rates).map(object);
    hotelRates = entries.flatMap((entry) => array(entry.rates).map(object));
    record("S4", "get-hotel-availability", "pass", {
      organizationCodeUsed: workingOrganizationCode,
      propertyEntryCount: entries.length,
      rateCount: hotelRates.length,
      bookableRateCount: hotelRates.filter((rate) => number(rate.quantity) > 0).length,
      zeroAmountRateCount: hotelRates.filter((rate) => nestedAmount(rate.totalAmount) === 0).length,
      sampleTotalAmount: hotelRates[0] ? nestedAmount(hotelRates[0].totalAmount) : null,
      currency: entries[0] ? string(object(entries[0].property).currencySymbol) : null,
      emptyAvailability: hotelRates.length === 0,
    }, traceStatus(PATH.hotelAvailability));
  } catch (error) {
    fail("S4", "get-hotel-availability", error, PATH.hotelAvailability);
  }
}

// ------------------------------------------- S5: crs/booking/get-room-availability

let roomTypeId = "";
let ratePlanId = "";
if (!canQueryProperty) {
  record("S5", "get-room-availability", "skip", { reason: tokenOk ? "Không xác định được propertyId" : "S1 chưa lấy được token" });
} else {
  try {
    resetTrace();
    const payload = await availability(PATH.roomAvailability, { propertyID: resolvedPropertyId });
    const data = object(object(payload).data);
    const rates = array(data.roomAvailabilityRates).map(object);
    const first = rates[0];
    if (first) {
      // Cấp một trả GUID toàn số 0; ID dùng được nằm trong roomType.roomTypeID / ratePlan.id.
      roomTypeId = string(object(first.roomType).roomTypeID, string(first.roomTypeId));
      ratePlanId = string(object(first.ratePlan).ratePlanId, string(object(first.ratePlan).id, string(first.ratePlanId)));
    }
    // Đây là endpoint duy nhất mà collection đã duyệt không có mẫu dữ liệu, nên fixture
    // `room-availability.json` đang là shape suy diễn. In tên khoá (không in giá trị) để đối chiếu.
    record("S5", "get-room-availability", "pass", {
      organizationCodeUsed: workingOrganizationCode,
      dataKeys: Object.keys(data),
      rateKeys: first ? Object.keys(first) : [],
      rateCount: rates.length,
      bookableRateCount: rates.filter((rate) => number(rate.quantity) > 0).length,
      hasTotalTaxAmount: first ? first.totalTaxAmount !== undefined : null,
      topLevelRoomTypeId: first ? first.roomTypeId ?? null : null,
      topLevelRatePlanId: first ? first.ratePlanId ?? null : null,
      nestedRoomTypeId: roomTypeId || null, nestedRatePlanId: ratePlanId || null,
      zeroGuidAtTopLevel: first ? string(first.roomTypeId) === ZERO_GUID || string(first.ratePlanId) === ZERO_GUID : null,
      emptyAvailability: rates.length === 0,
    }, traceStatus(PATH.roomAvailability));
  } catch (error) {
    fail("S5", "get-room-availability", error, PATH.roomAvailability);
  }
}

// ------------------------------------ S6: crs/booking/get-room-detail-availability

if (!canQueryProperty || !roomTypeId || !ratePlanId) {
  record("S6", "get-room-detail-availability", "skip", { reason: canQueryProperty ? "S5 không trả về roomTypeId/ratePlanId" : "Chưa qua được tầng trước" });
} else {
  try {
    resetTrace();
    const payload = await availability(PATH.roomDetail, {
      propertyID: resolvedPropertyId, roomTypeId, ratePlanId,
      isFilteredByRoomTypeId: true, isFilteredByRatePlanId: true,
    });
    const data = object(object(payload).data);
    const entries = array(data.roomAvailabilityRates).map(object);
    const item = entries[0];
    const dailyRates = item ? array(item.rates).map(object) : [];
    record("S6", "get-room-detail-availability", "pass", {
      organizationCodeUsed: workingOrganizationCode,
      dataKeys: Object.keys(data),
      entryCount: entries.length,
      dailyRateCount: dailyRates.length,
      hasDetailTotalTax: item ? item.totalTaxAmount !== undefined : null,
      hasDailyTaxAmount: dailyRates[0] ? dailyRates[0].taxAmount !== undefined : null,
      policyTypes: item ? array(item.policies).map((policy) => string(object(policy).type)) : [],
      emptyAvailability: entries.length === 0,
    }, traceStatus(PATH.roomDetail));
  } catch (error) {
    fail("S6", "get-room-detail-availability", error, PATH.roomDetail);
  }
}

// ------------------------------------------------------------------- Tổng kết

const failed = steps.filter((step) => step.status === "fail");
console.info(JSON.stringify({
  summary: failed.length === 0 ? "ok" : "failed",
  pass: steps.filter((step) => step.status === "pass").map((step) => step.id),
  fail: failed.map((step) => step.id),
  skip: steps.filter((step) => step.status === "skip").map((step) => step.id),
  organizationCodeUsed: workingOrganizationCode,
}));
if (failed.length > 0) process.exitCode = 1;
