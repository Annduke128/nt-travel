import path from "node:path";
import { createApp } from "./app.js";
import { SupabaseAuthService } from "./auth/supabase.js";
import { UnconfiguredAuthService } from "./auth/unconfigured.js";
import { CloudHmsBedbankService } from "./cloudhms/bedbank.js";
import { CloudHmsClient } from "./cloudhms/client.js";
import { MockBedbankService } from "./cloudhms/mock.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const auth = config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey
  ? new SupabaseAuthService(config.supabaseUrl, config.supabaseAnonKey, config.supabaseServiceRoleKey)
  : new UnconfiguredAuthService();
const bedbank = config.cloudHms.mode === "live"
  ? new CloudHmsBedbankService(new CloudHmsClient(config.cloudHms), config.cloudHms.distributionChannelId, config.cloudHms.organizationCode, config.cloudHms.concurrency)
  : new MockBedbankService();
const publicDir = path.resolve(process.cwd(), "dist");
const app = createApp({ auth, bedbank, production: config.nodeEnv === "production", publicDir });

app.listen(config.port, "127.0.0.1", () => {
  console.info(JSON.stringify({ service: "nt-travel-bff", mode: config.cloudHms.mode, port: config.port }));
});
