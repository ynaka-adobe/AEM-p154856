# xsc-demo Closed User Groups (Okta) — AEM Edge Function

Enforces [Closed User Groups](https://www.aem.live/developer/closed-user-groups)
for **xsc-demo.ynaka-adobe.com** only, with Okta (OIDC Authorization Code + PKCE)
as the login. Other sites on this CDN are unaffected.

How it works:

1. `config-eds/cdn.yaml` (`route-xsc-demo-cug`) sends every request on
   `xsc-demo.ynaka-adobe.com`, except `/blocks|scripts|styles|fonts|icons/`, to
   this function.
2. The function fetches the page from `main--xsc-demo--ynaka-adobe.aem.live`,
   reads and strips the `x-aem-cug-required`, `x-aem-cug-groups` and
   `x-aem-cug-login-path` headers, then:
   - public page: serves it;
   - protected page, no session: browser navigations get a 302 to
     `/auth/login`, other requests get a 401;
   - logged in but not in a required group: 403.
3. `/auth/login`, `/auth/callback`, `/auth/logout` and `/auth/me` handle the
   Okta flow. The session is an HMAC-signed, HttpOnly cookie holding the user's
   email, name and Okta `groups`. ID tokens are verified against Okta's JWKS.

## Configuration

All keys are prefixed `XSC_` because `config_default` and `secret_default` are
shared with the other functions. They are declared in `config-eds/edgeFunctions.yaml`.

| Key | Store | Notes |
| --- | --- | --- |
| `XSC_OKTA_ISSUER` | config | e.g. `https://acme.okta.com` (org server) or `https://acme.okta.com/oauth2/default` |
| `XSC_OKTA_CLIENT_ID` | config | Okta app client ID |
| `XSC_OKTA_SCOPES` | config | optional, default `openid profile email groups` |
| `XSC_OKTA_GROUPS_CLAIM` | config | optional, default `groups` |
| `XSC_SESSION_TTL` | config | optional, seconds, default `28800` |
| `XSC_ORIGIN_HOSTNAME` | config | optional, default `main--xsc-demo--ynaka-adobe.aem.live` |
| `XSC_PUBLIC_ORIGIN` | config | optional, default `https://xsc-demo.ynaka-adobe.com` |
| `XSC_OKTA_CLIENT_SECRET` | secret | Cloud Manager secret `XSC_OKTA_CLIENT_SECRET` |
| `XSC_SESSION_SECRET` | secret | Cloud Manager secret `XSC_SESSION_SECRET`, at least 32 random characters (`openssl rand -base64 48`) |

> **Important:** create both Cloud Manager **secret** environment variables
> *before* running the config pipeline. A missing secret fails the deploy for
> **every** site on this CDN.

### Sandbox programs (p154856)

Sandbox programs have no config or secret stores, so the function falls back to:

- built-in defaults for `XSC_OKTA_ISSUER` / `XSC_OKTA_CLIENT_ID` (see `src/index.js`);
- values injected at build time from a gitignored `.env` (copy `.env.example`):
  `npm run build` runs `scripts/gen-build-env.mjs`, which writes any `XSC_*`
  values to `src/generated/build-env.js`.

These values are embedded in the deployed package. Store values still take
priority when the stores exist.

## Dynamic Media secure delivery (`/auth/dm-token`)

`GET /auth/dm-token` returns `{ token: "sd:…", expiryTime, delivery, groups }`
for the signed-in user (401 when signed out). The function:

1. gets an IMS access token for the OAuth Server-to-Server tech account (an AEM
   admin) and caches it in memory;
2. calls `POST {delivery}/adobe/assets/token` with the user's Okta `groups`.

Pages append `?token=sd:…` to Dynamic Media delivery URLs. Assets whose
`accessgroups` metadata matches one of the groups return 200; others return 404.

Settings (`XSC_` prefix, store or `.env`):

| Key | Default |
|---|---|
| `XSC_DM_CLIENT_ID`, `XSC_DM_CLIENT_SECRET` (secret), `XSC_DM_SCOPE` | required |
| `XSC_DM_DELIVERY` | `https://delivery-p154856-e1944736.adobeaemcloud.com` |
| `XSC_DM_TOKEN_TTL` | `900` seconds |

## Okta setup

1. Create an **OIDC Web Application** app integration (grant type: Authorization Code).
   - Sign-in redirect URI: `https://xsc-demo.ynaka-adobe.com/auth/callback`
   - Sign-out redirect URI: `https://xsc-demo.ynaka-adobe.com/`
2. Add a **groups claim** to the ID token:
   - Org authorization server: app **Sign On** tab, Groups claim filter
     `groups` matches regex `.*`.
   - Custom authorization server: add a `groups` claim (ID token, filter
     regex `.*`), and set `XSC_OKTA_SCOPES` to `openid profile email`.
3. Create the groups used in the site's `closed-user-groups` sheet (for
   example `partners`) and assign users.

## Site (DA) setup

1. Preview and publish `closed-user-groups` at the site root.
2. Add the **Protected Pages** plugin to the DA `prepare` config sheet
   (`https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/cug/cug.html`)
   and apply page access. The CUG headers only appear after this step.

## Build, test and deploy

```bash
npm install
npm run build                 # builds bin/main.wasm
fastly compute serve --skip-build --file bin/main.wasm   # local Viceroy on :7676
```

Deploy (requires the AEM Administrator product profile and `aio aem edge-functions setup`):

```bash
aio aem edge-functions build
aio aem edge-functions deploy xsc-demo-cug
aio aem edge-functions tail-logs xsc-demo-cug
```

Then run the Edge Delivery config pipeline for `/config-eds`.

## Notes

- `*.aem.page` / `*.aem.live` URLs stay public unless site authentication is
  enabled. Turn it on if the protected content must not be reachable directly.
- Responses from the function are never cached (`skipCache` and `CacheOverride('pass')`).
