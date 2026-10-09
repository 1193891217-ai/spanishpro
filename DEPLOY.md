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

## Supabase Auth setup

1. Enable email/password sign-up and require email confirmation.
2. Set the minimum password length to at least 8 characters.
3. Set the site URL to `https://spanish123.kicp.fun` and add that URL as an allowed redirect URL.
4. Configure production SMTP so confirmation messages reliably reach users.
5. Copy the project URL and publishable key into Vercel environment variables above.
6. Keep Supabase Auth's sign-up and password recovery rate limits enabled; add CAPTCHA before public launch if the project receives automated sign-up abuse.

The frontend requires sign-in before practice. Users can sign in again on another browser/device; their count and entitlement are loaded by account ID from the server. Only fully correct words increment the count. The database key changes at midnight in `Asia/Shanghai`.

After deploying the Vercel API, deploy the updated HTML. Existing local-only counts cannot be imported reliably. Purchases made before account binding may need manual account association; do not rely on old browser-local `proUntil` values as proof of payment.

### Associate a verified legacy purchase

For a purchase made before account sign-in was added, first verify the transaction in the JianPay merchant dashboard and identify the purchaser's Supabase user UUID from the Auth users page. Only then, in the private Upstash console, set `license:<user-uuid>` to a JSON object with `expiresAt` set to `4102444800000`, the verified `orderNo`, and `paidAt` as the current Unix timestamp in milliseconds. Do not expose the Upstash token or create a public endpoint that lets users claim old orders. Ask the purchaser to sign in again to load the entitlement.

The answer checking and vocabulary still run in the browser because this is a static quiz page. This backend secures account identity, stored quota, and payment entitlements; it cannot prevent a technically capable user from modifying their own browser code or viewing public vocabulary. Keep all purchase decisions and account entitlements server-side as implemented here.

## Existing services

This implementation expects the existing Upstash Redis REST database and JianPay merchant configuration. Confirm all required environment variables are set in Vercel Preview and Production before switching the frontend.
