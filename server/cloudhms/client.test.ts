// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { CloudHmsClient } from "./client.js";
import type { CloudHmsConfig } from "../config.js";

const config: CloudHmsConfig = {
  mode: "live",
  apiUrl: "https://booking.example",
  identityUrl: "https://identity.example",
  clientId: "client",
  clientSecret: "secret",
  organizationId: "org-id",
  organizationCode: "Vingroup",
  distributionChannelId: "channel-id",
  requestorId: "requestor-id",
  timeoutMs: 1000,
  concurrency: 2,
};

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("CloudHMS HTTP client", () => {
  test("never replays a booking mutation after a server failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: "token", expires_in: 3600 }))
      .mockImplementation(async () => response(500, { message: "failed" }));
    const client = new CloudHmsClient(config, fetcher);
    await expect(client.request("/common-trd/v1/crs/booking", { body: {}, retry: false })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("caches a client-credentials token before expiry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: "token-1", expires_in: 3600 }))
      .mockImplementation(async () => response(200, { data: [] }));
    const client = new CloudHmsClient(config, fetcher);

    await client.request("/hotels/info", { method: "POST", body: {} });
    await client.request("/hotels/info", { method: "POST", body: {} });

    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("connect/token"))).toHaveLength(1);
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://booking.example/hotels/info",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer token-1" }) }),
    );
  });

  test("token request carries the organization identifier", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: "token-1", expires_in: 3600 }))
      .mockImplementation(async () => response(200, { data: [] }));
    const client = new CloudHmsClient(config, fetcher);

    await client.request("/hotels/info", { method: "GET" });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://identity.example/connect/token");
    expect(String(init.body)).toContain("organization_id=org-id");
  });

  test("api requests only send documented headers", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: "token-1", expires_in: 3600 }))
      .mockImplementation(async () => response(200, { data: [] }));
    const client = new CloudHmsClient(config, fetcher);

    await client.request("/hotels/info", { method: "GET" });

    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(Object.keys(init.headers as Record<string, string>).sort())
      .toEqual(["accept", "authorization", "content-type", "x-correlation-id"]);
  });

  test("refreshes the token and retries exactly once after 401", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: "expired", expires_in: 3600 }))
      .mockResolvedValueOnce(response(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(response(200, { access_token: "fresh", expires_in: 3600 }))
      .mockResolvedValueOnce(response(200, { data: [{ id: "p1" }] }));
    const client = new CloudHmsClient(config, fetcher);

    const result = await client.request("/hotels/info", { method: "POST", body: {} });

    expect(result).toEqual({ data: [{ id: "p1" }] });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
