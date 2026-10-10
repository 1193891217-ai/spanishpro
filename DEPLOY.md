# Spanish123 account and quota backend

## Files

- `index.html` is the updated static frontend. Deploy it to the site hosting `https://spanish123.kicp.fun`.
- Copy `api/*.js` and `lib/server.js` into the root of the Vercel backend repository, preserving those paths.
- `api/pay.js` authenticates order creation/status, validates JianPay callbacks and stores the paid entitlement against the authenticated Supabase user.
- `api/usage.js` stores the daily correct-answer count in Upstash Redis and caps it atomically at 100 per account per China calendar day.
- `api/access.js` returns the signed-in account's server-side entitlement.
- `api/config.js` returns only the Supabase project URL and publishable key to the browser.

## Vercel environment variables

Keep these values in Vercel project settings, never in `index.html` or GitHub:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `JIANPAY_GATEWAY`
- `JIANPAY_CLIENT_NO`
- `JIANPAY_KEY`
- `ALLOW_ORIGIN=https://spanish123.kicp.fun`
- `BACKEND_URL=https://spanishpro.vercel.app` (or the actual custom API domain)

`JIANPAY_KEY` and `UPSTASH_REDIS_REST_TOKEN` are secrets. Do not paste them into chat or commit them. The Supabase secret/service-role key is not used by this implementation and must not be exposed in the browser.

## Anonymous practice sessions

New visitors do not need to register or sign in. The frontend obtains a server-signed anonymous session and sends it to the Vercel API. Daily correct-answer usage and JianPay entitlements are stored server-side under that session. The session persists in the browser's local storage.

- Set `ANON_SESSION_SECRET` to a long random secret in Vercel (recommended). If it is absent, the implementation derives a separate signing key from the existing secret `JIANPAY_KEY`.
- Keep the Supabase environment values for existing signed-in users and paid accounts that still have their old browser session. New anonymous sessions do not require a Supabase login.
- The limit is 100 correct answers per China calendar day per browser session. Incorrect answers do not count.
- A user who clears browser storage or switches devices receives a new anonymous session. Without an account or phone identity, a strict per-person limit and automatic cross-device recovery cannot be guaranteed. The payment dialog discloses that permanent access is tied to the current browser.
- For person-level quotas and cross-device purchase recovery, a stable identity such as a verified phone number or account is required.

The database key changes at midnight in `Asia/Shanghai`. After deploying the Vercel API and frontend, verify the session, quota, callback, and order-status paths in production. Existing account-bound purchases remain tied to their old Supabase user IDs; a legacy signed-in browser session can still load them.

### Associate a verified legacy purchase

For a purchase made before account sign-in was added, first verify the transaction in the JianPay merchant dashboard and identify the purchaser's Supabase user UUID from the Auth users page. Only then, in the private Upstash console, set `license:<user-uuid>` to a JSON object with `expiresAt` set to `4102444800000`, the verified `orderNo`, and `paidAt` as the current Unix timestamp in milliseconds. Do not expose the Upstash token or create a public endpoint that lets users claim old orders. Ask the purchaser to sign in again to load the entitlement.

The answer checking and vocabulary still run in the browser because this is a static quiz page. This backend secures account identity, stored quota, and payment entitlements; it cannot prevent a technically capable user from modifying their own browser code or viewing public vocabulary. Keep all purchase decisions and account entitlements server-side as implemented here.

## Existing services

This implementation expects the existing Upstash Redis REST database and JianPay merchant configuration. Confirm all required environment variables are set in Vercel Preview and Production before switching the frontend.
