import { existsSync } from "node:fs";

// Tiện ích cho môi trường phát triển: `tsx` không tự nạp `.env`.
// Production nhận biến từ secret store / `docker --env-file` và không đóng gói `.env`
// (xem `.dockerignore`), nên nhánh này không chạy khi NODE_ENV=production.
if (process.env.NODE_ENV !== "production" && existsSync(".env")) process.loadEnvFile(".env");
