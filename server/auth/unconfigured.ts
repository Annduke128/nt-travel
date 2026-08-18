import { AppError } from "../errors.js";
import type { AuthService } from "../services.js";

const unavailable = () => { throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Supabase Auth chưa được cấu hình"); };

export class UnconfiguredAuthService implements AuthService {
  health = async () => unavailable();
  login = async () => unavailable();
  authenticate = async () => unavailable();
  refresh = async () => unavailable();
  logout = async () => unavailable();
  changePassword = async () => unavailable();
  listUsers = async () => unavailable();
  createUser = async () => unavailable();
  updateUser = async () => unavailable();
  resetPassword = async () => unavailable();
}
