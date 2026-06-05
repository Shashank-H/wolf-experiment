# Research: Zerodha Kite Connect login/session flow and token expiry behavior

## Summary
Kite Connect uses a daily interactive login flow: send the user to the Kite login URL, receive a short-lived one-time `request_token` on the registered redirect URL, and exchange it server-side for an `access_token`. The `access_token` is valid only for the trading day/until Zerodha's daily session expiry (commonly documented as around 6 AM IST); it cannot be refreshed or extended, so implementations should persist and reuse it intraday and require a fresh login after expiry.

## Findings
1. **Login starts with Zerodha's Connect login URL and a registered redirect.** The documented login endpoint is `https://kite.zerodha.com/connect/login?v=3&api_key=<api_key>`. After successful login, Zerodha redirects the user to the app's redirect URL configured in the Kite developer console with query parameters such as `request_token`, `action`, and `status`. Implementation guidance: expose a callback URL, validate the query/status, and immediately exchange the token on the backend. [Kite Connect authentication docs](https://kite.trade/docs/connect/v3/user/#login-flow)

2. **`request_token` must be exchanged once using a SHA-256 checksum.** The session-generation API is `POST https://api.kite.trade/session/token` with form fields `api_key`, `request_token`, and `checksum`, where `checksum = sha256(api_key + request_token + api_secret)`. The response includes `access_token` and user profile/session fields. Treat `request_token` as short-lived and single-use; do not store it except transiently for the exchange. [Kite Connect authentication docs](https://kite.trade/docs/connect/v3/user/#generate-session)

3. **Authenticated REST calls use the Kite token auth header.** Kite Connect v3 expects `Authorization: token <api_key>:<access_token>` on API requests. Implementation guidance: centralize auth header construction and never send `api_secret` after the initial exchange. [Kite Connect API docs](https://kite.trade/docs/connect/v3/)

4. **Access tokens are daily session tokens, not refreshable long-lived credentials.** Zerodha documents/forums consistently indicate the `access_token` expires daily, generally at/around 6 AM IST, and there is no supported refresh-token flow to maximize or extend the expiry. Implementation guidance: store the access token securely for the day, detect `TokenException`/HTTP 403 auth failures, clear the token, and trigger a new interactive login. [Kite Connect forum: access token validity](https://kite.trade/forum/discussion/3468/access-token-validity) [Kite Connect exceptions docs](https://kite.trade/docs/connect/v3/exceptions/)

5. **Manual/interactive login is the intended model.** Attempts to automate username/password/TOTP login are brittle and may violate the intended security model; the supported API flow is user login through Kite followed by `request_token` exchange. For a production app, design UX/ops around one login per day rather than trying to refresh sessions. [Kite Connect authentication docs](https://kite.trade/docs/connect/v3/user/#login-flow)

## Sources
- Kept: Kite Connect v3 User/Auth docs (https://kite.trade/docs/connect/v3/user/#login-flow) — primary documentation for login URL, redirect callback, `request_token`, and session generation.
- Kept: Kite Connect v3 API docs (https://kite.trade/docs/connect/v3/) — primary documentation for API request authentication header format.
- Kept: Kite Connect v3 Exceptions docs (https://kite.trade/docs/connect/v3/exceptions/) — useful for handling expired/invalid token errors such as `TokenException`.
- Kept: Zerodha Kite Connect forum discussion on access token validity (https://kite.trade/forum/discussion/3468/access-token-validity) — practical confirmation of daily expiry behavior and lack of refresh/extension path.
- Dropped: Unofficial blog posts/GitHub snippets — excluded because official Zerodha docs and forum answers are more authoritative for auth/session behavior.

## Gaps
Live verification of the current wording in Zerodha docs was not possible from the available tool environment, so exact current phrasing and any recently changed edge cases should be checked against the official docs before release. Recommended next step: test the full flow in a sandbox/dev app by logging in, exchanging the `request_token`, making one authenticated call, and confirming behavior after the next daily expiry window.

## Implementation guidance
- Generate login link: `https://kite.zerodha.com/connect/login?v=3&api_key=YOUR_API_KEY`.
- Callback handler: read `request_token`; reject missing/failed `status`; immediately call `/session/token`.
- Checksum: `sha256(api_key + request_token + api_secret)`.
- Store: persist only `access_token` securely, with an app-side expiry no later than the next 6 AM IST.
- Use header: `Authorization: token YOUR_API_KEY:ACCESS_TOKEN`.
- Refresh strategy: none; on expiry/auth failure, discard token and require fresh user login.
