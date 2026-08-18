type ClosableServer = {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
};

export function shutdownServer(server: ClosableServer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error("HTTP shutdown timed out")), timeoutMs);
    timeout.unref();
    try {
      server.close((error) => finish(error));
      server.closeIdleConnections?.();
    } catch (error) {
      finish(error instanceof Error ? error : new Error("HTTP shutdown failed"));
    }
  });
}
