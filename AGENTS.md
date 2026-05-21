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
