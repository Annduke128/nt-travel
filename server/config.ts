import { z } from "zod";

export type CloudHmsConfig = {
  mode: "mock" | "live";
  apiUrl: string;
  identityUrl: string;
  clientId: string;
  clientSecret: string;
  organizationId: string;
  organizationCode: string;
  distributionChannelId: string;
  requestorId: string;
  timeoutMs: number;
  concurrency: number;
};

export type ServerConfig = {
  port: number;
  nodeEnv: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  cloudHms: CloudHmsConfig;
};

const environmentSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  CLOUDHMS_MODE: z.enum(["mock", "live"]).default("mock"),
  CLOUDHMS_API_URL: z.string().default("https://mock.cloudhms.invalid"),
  CLOUDHMS_IDENTITY_URL: z.string().default("https://mock.cloudhms.invalid"),
  CLOUDHMS_CLIENT_ID: z.string().default(""),
  CLOUDHMS_CLIENT_SECRET: z.string().default(""),
  CLOUDHMS_ORGANIZATION_ID: z.string().default(""),
  CLOUDHMS_ORGANIZATION_CODE: z.string().default("Vingroup"),
  CLOUDHMS_DISTRIBUTION_CHANNEL_ID: z.string().default(""),
  CLOUDHMS_REQUESTOR_ID: z.string().default(""),
  CLOUDHMS_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  CLOUDHMS_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const value = environmentSchema.parse(environment);
  if (value.CLOUDHMS_MODE === "live") {
    const required = [
      "CLOUDHMS_CLIENT_ID",
      "CLOUDHMS_CLIENT_SECRET",
      "CLOUDHMS_ORGANIZATION_ID",
      "CLOUDHMS_DISTRIBUTION_CHANNEL_ID",
      "CLOUDHMS_REQUESTOR_ID",
    ] as const;
    const missing = required.filter((key) => !value[key]);
    if (missing.length > 0) throw new Error(`Thiếu cấu hình CloudHMS live: ${missing.join(", ")}`);
  }
  if (value.NODE_ENV === "production") {
    const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !value[key as keyof typeof value]);
    if (missing.length > 0) throw new Error(`Thiếu cấu hình Supabase production: ${missing.join(", ")}`);
  }
  return {
    port: value.PORT,
    nodeEnv: value.NODE_ENV,
    supabaseUrl: value.SUPABASE_URL,
    supabaseAnonKey: value.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
    cloudHms: {
      mode: value.CLOUDHMS_MODE,
      apiUrl: value.CLOUDHMS_API_URL.replace(/\/$/, ""),
      identityUrl: value.CLOUDHMS_IDENTITY_URL.replace(/\/$/, ""),
      clientId: value.CLOUDHMS_CLIENT_ID,
      clientSecret: value.CLOUDHMS_CLIENT_SECRET,
      organizationId: value.CLOUDHMS_ORGANIZATION_ID,
      organizationCode: value.CLOUDHMS_ORGANIZATION_CODE,
      distributionChannelId: value.CLOUDHMS_DISTRIBUTION_CHANNEL_ID,
      requestorId: value.CLOUDHMS_REQUESTOR_ID,
      timeoutMs: value.CLOUDHMS_TIMEOUT_MS,
      concurrency: value.CLOUDHMS_CONCURRENCY,
    },
  };
}
