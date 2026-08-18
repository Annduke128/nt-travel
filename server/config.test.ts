// @vitest-environment node
import { describe, expect, test } from "vitest";
import { loadConfig } from "./config.js";

describe("production runtime config", () => {
  test("defaults to loopback with no trusted proxy", () => {
    const config = loadConfig({});

    expect(config.host).toBe("127.0.0.1");
    expect(config.trustProxyHops).toBe(0);
    expect(config.shutdownTimeoutMs).toBe(10_000);
    expect(config.readinessCacheMs).toBe(10_000);
  });

  test("accepts an explicit container host and exact proxy hop count", () => {
    const config = loadConfig({
      HOST: "0.0.0.0",
      TRUST_PROXY_HOPS: "1",
      SHUTDOWN_TIMEOUT_MS: "15000",
      READINESS_CACHE_MS: "5000",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.trustProxyHops).toBe(1);
    expect(config.shutdownTimeoutMs).toBe(15_000);
    expect(config.readinessCacheMs).toBe(5_000);
  });

  test("rejects unsafe proxy hop counts", () => {
    expect(() => loadConfig({ TRUST_PROXY_HOPS: "20" })).toThrow();
  });
});
