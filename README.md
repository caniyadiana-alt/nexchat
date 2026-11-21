# NEXCHAT — Cloudflare Chat Starter

A responsive private/group messaging application starter for Cloudflare Workers + D1.

## Included
- Email/password registration and login
- Password hashing with PBKDF2 (Web Crypto)
- HttpOnly session cookie; logout and session expiry
- Direct conversations and group conversations
- Server-side membership checks for every conversation read/write
- Persistent message history in D1
- User search, create direct chat, create group
- Responsive dark UI, light/dark toggle, settings, notification preference
- Original synthesized ambient loop using Web Audio (no copyrighted music assets)
- Polling-based near-real-time message updates

## Deploy to Cloudflare
1. Create a Cloudflare account and install Node.js (18+).
2. Unzip this project.
3. In the project folder run:
   ```bash
   npm install
   npx wrangler login
   ```
4. Create the D1 database:
   ```bash
   npx wrangler d1 create nexchat-db
   ```
5. Copy the returned database ID into `wrangler.toml` replacing `REPLACE_WITH_D1_DATABASE_ID`.
6. Initialize tables:
   ```bash
   npx wrangler d1 execute nexchat-db --remote --file=./schema.sql
   ```
7. Deploy:
   ```bash
   npm run deploy
   ```
8. Open the `*.workers.dev` URL printed by Wrangler.

For local development:
```bash
npm run dev
```
Then initialize local D1:
```bash
npx wrangler d1 execute nexchat-db --local --file=./schema.sql
```

## Important production checklist
- Add a custom domain in Cloudflare Workers.
- Set a strong `SESSION_SECRET` secret:
  ```bash
  npx wrangler secret put SESSION_SECRET
  ```
  The app works with a random per-deployment fallback for demos, but a stable secret is recommended for production.
- Configure Cloudflare Turnstile/rate limiting before public launch.
- Add account email verification and password reset before using with the public.
- Configure backups/retention for D1.
- Review applicable privacy and data-protection obligations.
- Voice/video calls and file uploads are shown as integration-ready UI placeholders; they require a signaling/media provider (e.g. WebRTC + TURN) and object storage such as R2 to become operational.
- Audio is an original synthesized ambient loop, not a streaming catalog of trending copyrighted songs.

## Privacy model
A direct conversation has exactly two participants. The API checks that the authenticated user is a participant before listing or sending messages. Group messages require current group membership. Do not remove these checks when extending the app.

## Project structure
- `src/index.js`: Worker API and static asset routing
- `schema.sql`: D1 schema
- `public/`: frontend
- `wrangler.toml`: Cloudflare configuration
