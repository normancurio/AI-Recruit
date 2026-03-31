<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0bed06fa-d7c2-4bee-8b7a-6feb2ef73a22

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set environment variables in `.env.local`:
   - `GEMINI_API_KEY` for Gemini API
   - `WECHAT_APPID` and `WECHAT_SECRET` for mini program `code2Session` openid exchange
   - `MYSQL_HOST` `MYSQL_PORT` `MYSQL_USER` `MYSQL_PASSWORD` `MYSQL_DATABASE` for API persistence
3. Run the app:
   `npm run dev`

For API server (including `POST /api/wechat/login`):
- Run `npm run dev:api`
