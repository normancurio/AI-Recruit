-- 管理库 ai_recruit_admin：为 users 增加登录口令哈希（与 server/index.ts 中 scrypt 格式一致）
-- 执行：mysql -u root -p ai_recruit_admin < server/migration_admin_users_password.sql
-- 若 password_hash 列已存在，可注释掉下方 ALTER，仅执行 UPDATE。

USE ai_recruit_admin;

ALTER TABLE users
  ADD COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL AFTER status;

-- 若表已存在且无唯一索引，可执行（已有则跳过报错）：
-- ALTER TABLE users ADD UNIQUE KEY uk_users_username (username);

-- 所有用户初始明文口令均为 123456（salt:hex 由 Node scrypt 生成；生产环境务必修改）
-- 重新生成：node server/scripts/print-admin-password-hash.mjs '新密码'
UPDATE users
SET password_hash = 'ai_recruit_init_123456:3fc16a3cd232ec694f1ef13bc3d0a0abe0e13c9ff3775fc5ef01ba7a94f3874266a1daff39ffcd9620bdce13f84e85c6379a1be51b34c1aca2b8244cb894fa5c';
