import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../errors.js";
import type { AuthService, Profile, Role, Session, UserStatus } from "../services.js";

type ProfileRow = { user_id: string; display_name: string; role: Role; status: UserStatus; must_change_password: boolean };

function safeProfile(row: ProfileRow, email: string): Profile {
  return { userId: row.user_id, email, displayName: row.display_name, role: row.role, status: row.status, mustChangePassword: row.must_change_password };
}

export class SupabaseAuthService implements AuthService {
  private readonly admin: SupabaseClient;
  private readonly publicClient: SupabaseClient;

  constructor(url: string, anonKey: string, serviceRoleKey: string) {
    this.admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    this.publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async profile(userId: string, email = ""): Promise<Profile> {
    const { data, error } = await this.admin.from("profiles").select("user_id,display_name,role,status,must_change_password").eq("user_id", userId).single();
    if (error || !data) throw new AppError(403, "FORBIDDEN", "Tài khoản chưa được cấp hồ sơ nhân viên");
    return safeProfile(data as ProfileRow, email);
  }

  async login(email: string, password: string): Promise<Session> {
    const { data, error } = await this.publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) throw new AppError(401, "AUTH_REQUIRED", "Email hoặc mật khẩu không đúng");
    const profile = await this.profile(data.user.id, data.user.email ?? email);
    if (profile.status !== "active") throw new AppError(403, "FORBIDDEN", "Tài khoản đã bị khóa");
    return { profile, accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in };
  }

  async authenticate(accessToken: string): Promise<Profile> {
    const { data, error } = await this.admin.auth.getUser(accessToken);
    if (error || !data.user) throw new AppError(401, "AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn");
    return this.profile(data.user.id, data.user.email ?? "");
  }

  async refresh(refreshToken: string): Promise<Session> {
    const { data, error } = await this.publicClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) throw new AppError(401, "AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn");
    const profile = await this.profile(data.user.id, data.user.email ?? "");
    if (profile.status !== "active") throw new AppError(403, "FORBIDDEN", "Tài khoản đã bị khóa");
    return { profile, accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in };
  }

  async logout(accessToken: string) {
    await this.admin.auth.admin.signOut(accessToken, "local");
  }

  async changePassword(profile: Profile, password: string) {
    const { error } = await this.admin.auth.admin.updateUserById(profile.userId, { password });
    if (error) throw new AppError(400, "VALIDATION_ERROR", "Không thể đổi mật khẩu");
    const { error: profileError } = await this.admin.from("profiles").update({ must_change_password: false }).eq("user_id", profile.userId);
    if (profileError) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể cập nhật hồ sơ nhân viên");
    await this.audit(profile.userId, "password.changed", profile.userId);
  }

  async listUsers(): Promise<Profile[]> {
    const [{ data: rows, error }, { data: users, error: usersError }] = await Promise.all([
      this.admin.from("profiles").select("user_id,display_name,role,status,must_change_password").order("created_at"),
      this.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error || usersError) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể tải danh sách nhân viên");
    const emails = new Map(users.users.map((user) => [user.id, user.email ?? ""]));
    return (rows as ProfileRow[]).map((row) => safeProfile(row, emails.get(row.user_id) ?? ""));
  }

  async createUser(actor: Profile, input: { email: string; displayName: string; role: Role; temporaryPassword: string }): Promise<Profile> {
    const { data, error } = await this.admin.auth.admin.createUser({ email: input.email, password: input.temporaryPassword, email_confirm: true });
    if (error || !data.user) throw new AppError(400, "VALIDATION_ERROR", "Không thể tạo tài khoản nhân viên");
    const row: ProfileRow = { user_id: data.user.id, display_name: input.displayName, role: input.role, status: "active", must_change_password: true };
    const { error: profileError } = await this.admin.from("profiles").insert(row);
    if (profileError) {
      await this.admin.auth.admin.deleteUser(data.user.id);
      throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể tạo hồ sơ nhân viên");
    }
    await this.audit(actor.userId, "user.created", data.user.id, { role: input.role });
    return safeProfile(row, input.email);
  }

  async updateUser(actor: Profile, userId: string, input: { role?: Role; status?: UserStatus; displayName?: string }): Promise<Profile> {
    if (actor.userId === userId && input.status === "disabled") throw new AppError(400, "VALIDATION_ERROR", "Admin không thể tự khóa tài khoản");
    const current = await this.profile(userId);
    if (current.role === "admin" && current.status === "active" && (input.role === "staff" || input.status === "disabled")) {
      const { count, error } = await this.admin.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "admin").eq("status", "active");
      if (error) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể kiểm tra quyền Admin");
      if ((count ?? 0) <= 1) throw new AppError(400, "VALIDATION_ERROR", "Không thể khóa hoặc hạ quyền Admin active cuối cùng");
    }
    const databaseInput = { ...(input.role ? { role: input.role } : {}), ...(input.status ? { status: input.status } : {}), ...(input.displayName ? { display_name: input.displayName } : {}) };
    const { data, error } = await this.admin.from("profiles").update(databaseInput).eq("user_id", userId).select("user_id,display_name,role,status,must_change_password").single();
    if (error || !data) throw new AppError(400, "VALIDATION_ERROR", "Không thể cập nhật nhân viên");
    await this.audit(actor.userId, "user.updated", userId, input);
    return safeProfile(data as ProfileRow, current.email);
  }

  async resetPassword(actor: Profile, userId: string, temporaryPassword: string) {
    const { error } = await this.admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
    if (error) throw new AppError(400, "VALIDATION_ERROR", "Không thể đặt lại mật khẩu");
    const { error: profileError } = await this.admin.from("profiles").update({ must_change_password: true }).eq("user_id", userId);
    if (profileError) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể cập nhật trạng thái mật khẩu");
    await this.audit(actor.userId, "password.reset", userId);
  }

  private async audit(actorUserId: string, action: string, targetUserId: string, metadata: Record<string, unknown> = {}) {
    const { error } = await this.admin.from("audit_events").insert({ actor_user_id: actorUserId, action, target_user_id: targetUserId, metadata });
    if (error) console.error(JSON.stringify({ level: "error", message: "audit insert failed", action, actorUserId, targetUserId }));
  }
}
