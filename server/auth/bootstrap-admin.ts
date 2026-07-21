import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config.js";

const config = loadConfig();
if (!config.supabaseUrl || !config.supabaseServiceRoleKey) throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const displayName = process.env.BOOTSTRAP_ADMIN_NAME ?? "NT Travel Admin";
if (!email) throw new Error("Thiếu BOOTSTRAP_ADMIN_EMAIL");

async function readSecret() {
  if (!stdin.isTTY) {
    let value = "";
    for await (const chunk of stdin) value += String(chunk);
    return value.trimEnd();
  }
  stdout.write("Mật khẩu Admin ban đầu: ");
  stdin.setRawMode(true);
  stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const character = chunk.toString("utf8");
      if (character === "\u0003") { stdin.setRawMode(false); reject(new Error("Đã hủy")); return; }
      if (character === "\r" || character === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); stdout.write("\n"); resolve(value); return; }
      if (character === "\u007f") { value = value.slice(0, -1); return; }
      value += character;
    };
    stdin.on("data", onData);
  });
}

const password = await readSecret();
if (password.length < 12) throw new Error("Mật khẩu phải có ít nhất 12 ký tự");

const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false } });
const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (existing.error) throw existing.error;
let user = existing.data.users.find((candidate) => candidate.email?.toLocaleLowerCase() === email.toLocaleLowerCase());
if (!user) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  user = created.data.user;
}
const { error } = await admin.from("profiles").upsert({ user_id: user.id, display_name: displayName, role: "admin", status: "active", must_change_password: true }, { onConflict: "user_id" });
if (error) throw error;
stdout.write(`Admin ${email} đã sẵn sàng.\n`);
