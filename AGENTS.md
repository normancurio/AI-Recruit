# AI-Recruit Project Instructions

Use this file as the project-level source of truth for Codex work in this repository.

## Module Names

- When the user says `后台`, work in `src/`.
- When the user says `客户端` or `用户端`, work in `miniapp-candidate/`（微信小程序）或 `web-candidate/`（PC/H5 浏览器版）。
- When the user says `服务端`, `api`, or `接口`, work in `server/`.

Keep answers and edits scoped to the named module unless the user explicitly asks to cross module boundaries.

## Environment Definitions

For this project, "local environment" means the developer/admin app running from the local checkout while using the development database on host `100.79.134.17`. That database host is reachable through the `company-mac-ssh` MCP target when remote inspection or repair is needed. Do not reinterpret "local environment" as `127.0.0.1` MySQL unless the user explicitly says to use a truly localhost database.

"Production" or "online environment" means the target service reachable through the `server-doctor-ssh` MCP target. The production project path is `/opt/AI-Recruit`.

## Local Restart Discipline

When Codex changes backend/API code such as `server/index.ts`, the running local API may still be an old process. Before telling the user to test, either restart/confirm the API process or explicitly tell the user that an API restart is required.

- Prefer local API watch mode: `npm run dev:api` from `/Users/jsonhe/shenpu-project/AI-Recruit`.
- Use the Node 26 runtime path from `use.txt` if plain `npm` is unavailable or resolves to Node 24.
- After backend edits, check port `3011` and confirm the command/start time. The process should be `tsx watch server/index.ts` or otherwise newer than the code change.
- If the process is not watch mode or was started before the edit, say clearly: "需要重启本地 API 后再测试，否则会测到旧逻辑。"
- Do not claim a backend fix is testable in the browser until the running API has picked up the latest code.

## Style-Only Requests

When the user asks to fix backend/admin styles:

- Treat `src/` as the target surface.
- Change presentation only: layout, spacing, typography, responsive classes, colors, and visual states.
- Do not change business logic, API calls, data transformations, permissions, routing behavior, or persistence.
- Preserve the existing desktop layout unless the user asks for a desktop redesign.
- Mobile adaptation should make the existing admin pages usable on narrow screens through wrapping, scrolling, and responsive spacing.

## Shenpu Resume Template Filling

Project-specific Shenpu resume templates are style sources. Treat them as "fill content into the existing template", not as permission to redesign the document.

- Preserve the uploaded template package, logo, borders, paragraph styles, table layout, section bars, and overall visual language.
- Do not create new internal grids/table lines unless the template already has that grid structure in the same section.
- If a section body is a single merged/cross-column cell, fill multiple paragraphs or tab-separated text inside that cell; do not clone rows into a new internal table.
- If the template already has explicit rows/columns for repeated education/work/project entries, reuse and clone those existing rows only when needed, preserving their styles.
- For project/work experience, preserve full original resume content; the template controls presentation only and must not cause details to be summarized away or dropped.
- Candidate name and all resume content should come from the original resume text first. File names, JD text, and template text are only fallback/context and must not override resume body content.
- After editing backend generation logic, restart or confirm the local API process before asking the user to validate generated Word/PDF files.

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

The production server cannot reliably run `git pull` because outbound GitHub access may hang. Do not use `git pull` in production release steps. Sync code from the clean local `main` branch by uploading a Git bundle, then fast-forward the server repo:

```bash
cd /Users/jsonhe/shenpu-project/AI-Recruit
bundle=/tmp/ai-recruit-main-$(git rev-parse --short HEAD).bundle
rm -f "$bundle"
git bundle create "$bundle" main
scp -i /Users/jsonhe/.ssh/health "$bundle" root@47.102.85.156:/tmp/
ssh -i /Users/jsonhe/.ssh/health root@47.102.85.156 "cd /opt/AI-Recruit && git fetch /tmp/$(basename "$bundle") main && git merge --ff-only FETCH_HEAD && rm -f /tmp/$(basename "$bundle")"
```

When the user asks to "发布 api":

```bash
cd /opt/AI-Recruit
docker compose build api
docker compose up -d --no-deps api
curl -sS https://mind.cisetech.com/api/health
docker compose logs --tail=100 api
```

When the user asks to "发布后台" or "发布 admin":

```bash
cd /opt/AI-Recruit
docker compose build admin
docker compose up -d --no-deps admin
curl -sS -I https://adminrecruit.cisetech.com/
docker compose logs --tail=100 admin
```

When the user asks to publish both API and admin:

```bash
cd /opt/AI-Recruit
docker compose build api admin
docker compose up -d api admin
curl -sS https://mind.cisetech.com/api/health
curl -sS -I https://adminrecruit.cisetech.com/
```

Release safety rules:

- Keep production downtime as short as possible. Finish local verification, schema checks, config checks, and Docker image builds before restarting services whenever the change allows it.
- Build images while the old containers are still running. Only run `docker compose up -d ...` after the build has succeeded and the exact services to restart are known.
- Restart only the minimum necessary service set, then immediately check the public health/admin URLs and relevant logs before declaring the release done.
- Only operate inside `/opt/AI-Recruit`.
- Only operate compose services explicitly requested: `api`, `admin`, or both.
- Do not run global Docker cleanup/stop/remove commands such as `docker system prune`, broad `docker stop`, or broad `docker rm`.
- Do not touch other Docker compose projects or unrelated services on the server.
- Do not reload Nginx unless domain, certificate, port, or `proxy_pass` config changed.
- Never run `git pull` on the production server during release; use the local Git bundle upload flow above.
- If `git status` on the server shows only untracked build-output fragments such as `=`, `CACHED`, `ERROR`, `[admin]`, `[api]`, `exporting`, `naming`, `reading`, `resolve`, `transferring`, or `unpacking`, those are safe to remove. Preserve `backups/`.
