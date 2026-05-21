# AI-Recruit Project Instructions

Use this file as the project-level source of truth for Codex work in this repository.

## Module Names

- When the user says `后台`, work in `src/`.
- When the user says `客户端` or `用户端`, work in `miniapp-candidate/`.
- When the user says `服务端`, `api`, or `接口`, work in `server/`.

Keep answers and edits scoped to the named module unless the user explicitly asks to cross module boundaries.

## Style-Only Requests

When the user asks to fix backend/admin styles:

- Treat `src/` as the target surface.
- Change presentation only: layout, spacing, typography, responsive classes, colors, and visual states.
- Do not change business logic, API calls, data transformations, permissions, routing behavior, or persistence.
- Preserve the existing desktop layout unless the user asks for a desktop redesign.
- Mobile adaptation should make the existing admin pages usable on narrow screens through wrapping, scrolling, and responsive spacing.

## Production Release

Production server facts verified on 2026-05-21:

- SSH target: `server-doctor-ssh` in Codex/Cursor MCP config, equivalent host `root@47.102.85.156` with key `/Users/jsonhe/.ssh/health`.
- Project path: `/opt/AI-Recruit`.
- Compose services:
  - `api`: container `ai-recruit-api-1`, host port `3011`, public URL `https://mind.cisetech.com`.
  - `admin`: container `ai-recruit-admin-1`, host port `3010`, public URL `https://adminrecruit.cisetech.com`.
- Nginx proxies:
  - `mind.cisetech.com` -> `http://127.0.0.1:3011`.
  - `adminrecruit.cisetech.com` -> `http://127.0.0.1:3010`.
- Admin runtime env must keep `MINIAPP_API_PUBLIC_URL=https://mind.cisetech.com` and `ADMIN_API_UPSTREAM=http://api:3011`.

When the user asks to "发布 api":

```bash
cd /opt/AI-Recruit
git pull
docker compose build api
docker compose up -d --no-deps api
curl -sS https://mind.cisetech.com/api/health
docker compose logs --tail=100 api
```

When the user asks to "发布后台" or "发布 admin":

```bash
cd /opt/AI-Recruit
git pull
docker compose build admin
docker compose up -d --no-deps admin
curl -sS -I https://adminrecruit.cisetech.com/
docker compose logs --tail=100 admin
```

When the user asks to publish both API and admin:

```bash
cd /opt/AI-Recruit
git pull
docker compose build api admin
docker compose up -d api admin
curl -sS https://mind.cisetech.com/api/health
curl -sS -I https://adminrecruit.cisetech.com/
```

Release safety rules:

- Only operate inside `/opt/AI-Recruit`.
- Only operate compose services explicitly requested: `api`, `admin`, or both.
- Do not run global Docker cleanup/stop/remove commands such as `docker system prune`, broad `docker stop`, or broad `docker rm`.
- Do not touch other Docker compose projects or unrelated services on the server.
- Do not reload Nginx unless domain, certificate, port, or `proxy_pass` config changed.
- If `git pull` hangs because the server cannot reach GitHub, use a local Git bundle from the clean local `main` branch and fast-forward the server repo instead of copying loose files.
- If `git status` on the server shows only untracked build-output fragments such as `=`, `CACHED`, `ERROR`, `[admin]`, `[api]`, `exporting`, `naming`, `reading`, `resolve`, `transferring`, or `unpacking`, those are safe to remove. Preserve `backups/`.
