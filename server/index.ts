import "./env.js";
import path from "node:path";
import { createApp } from "./app.js";
import { SupabaseAuthService } from "./auth/supabase.js";
import { UnconfiguredAuthService } from "./auth/unconfigured.js";
import { CloudHmsBedbankService } from "./cloudhms/bedbank.js";
import { CloudHmsClient } from "./cloudhms/client.js";
import { MockBedbankService } from "./cloudhms/mock.js";
import { loadConfig } from "./config.js";
import { shutdownServer } from "./runtime.js";

const config = loadConfig();
const auth = config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey
  ? new SupabaseAuthService(config.supabaseUrl, config.supabaseAnonKey, config.supabaseServiceRoleKey)
  : new UnconfiguredAuthService();
const bedbank = config.cloudHms.mode === "live"
  ? new CloudHmsBedbankService(new CloudHmsClient(config.cloudHms), config.cloudHms.distributionChannelId, config.cloudHms.organizationCode, config.cloudHms.concurrency)
  : new MockBedbankService();
const publicDir = path.resolve(process.cwd(), "dist");
const app = createApp({
  auth,
  bedbank,
  production: config.nodeEnv === "production",
  publicDir,
  trustProxyHops: config.trustProxyHops,
  readinessCacheMs: config.readinessCacheMs,
  readiness: async () => {
    await Promise.all([auth.health(), bedbank.health()]);
  },
});

const server = app.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ service: "nt-travel-bff", event: "started", mode: config.cloudHms.mode, host: config.host, port: config.port }));
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ service: "nt-travel-bff", event: "shutdown_started", signal }));
  try {
    await shutdownServer(server, config.shutdownTimeoutMs);
    console.info(JSON.stringify({ service: "nt-travel-bff", event: "shutdown_complete", signal }));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ service: "nt-travel-bff", event: "shutdown_failed", signal, message: error instanceof Error ? error.message : "Unknown error" }));
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
