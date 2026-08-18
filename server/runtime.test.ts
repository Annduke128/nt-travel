// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { shutdownServer } from "./runtime.js";

describe("HTTP runtime shutdown", () => {
  test("stops accepting traffic and resolves after connections drain", async () => {
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => callback()),
      closeIdleConnections: vi.fn(),
    };

    await shutdownServer(server, 1000);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  test("rejects when the drain deadline expires", async () => {
    vi.useFakeTimers();
    const server = {
      close: vi.fn(),
      closeIdleConnections: vi.fn(),
    };

    const shutdown = shutdownServer(server, 1000);
    const rejection = expect(shutdown).rejects.toThrow("HTTP shutdown timed out");
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    vi.useRealTimers();
  });
});
