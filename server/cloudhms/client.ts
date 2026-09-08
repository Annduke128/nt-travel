import { randomUUID } from "node:crypto";
import type { CloudHmsConfig } from "../config.js";
import { AppError } from "../errors.js";

type Fetcher = typeof fetch;
type RequestOptions = { method?: "GET" | "POST"; body?: unknown; correlationId?: string; retry?: boolean };
type Token = { value: string; expiresAt: number };

export class CloudHmsClient {
  private token?: Token;
  private tokenPromise?: Promise<Token>;

  constructor(private readonly config: CloudHmsConfig, private readonly fetcher: Fetcher = fetch) {}

  private async acquireToken(force = false): Promise<Token> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 60_000) return this.token;
    if (!force && this.tokenPromise) return this.tokenPromise;
    const request = async () => {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        organization_id: this.config.organizationId,
      });
      let response: Response;
      try {
        response = await this.fetcher(`${this.config.identityUrl}/connect/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch {
        throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể xác thực với CloudHMS");
      }
      if (!response.ok) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "CloudHMS từ chối xác thực");
      const payload = await response.json() as { access_token?: string; expires_in?: number };
      if (!payload.access_token) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Phản hồi token CloudHMS không hợp lệ");
      const token = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 300) * 1000 };
      this.token = token;
      return token;
    };
    this.tokenPromise = request().finally(() => { this.tokenPromise = undefined; });
    return this.tokenPromise;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const correlationId = options.correlationId ?? randomUUID();
    let token = await this.acquireToken();
    let didRefresh = false;
    let transientAttempts = 0;

    for (;;) {
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await this.fetcher(`${this.config.apiUrl}${path}`, {
          method: options.method ?? "POST",
          // Chỉ gửi header có trong collection CloudHMS đã duyệt, cộng x-correlation-id
          // dùng cho log tương quan của chính BFF.
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token.value}`,
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch {
        throw new AppError(503, "UPSTREAM_UNAVAILABLE", "CloudHMS không phản hồi");
      }
      console.info(JSON.stringify({ service: "cloudhms", path, status: response.status, latencyMs: Date.now() - startedAt, correlationId }));
      if (response.status === 401 && !didRefresh && options.retry !== false) {
        this.token = undefined;
        token = await this.acquireToken(true);
        didRefresh = true;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && transientAttempts < 2 && options.retry !== false) {
        transientAttempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** transientAttempts));
        continue;
      }
      if (response.status === 429) throw new AppError(503, "UPSTREAM_RATE_LIMITED", "CloudHMS đang giới hạn tần suất truy cập");
      if (!response.ok) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "CloudHMS tạm thời không khả dụng");
      return await response.json() as T;
    }
  }
}
