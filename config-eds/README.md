# Edge Delivery CDN configuration

Deploy this directory with the existing Cloud Manager **Edge Delivery
configuration pipeline**, automatically triggered by commits to `main` in
this program. `/config` is for the separate AEM environment
configuration pipeline; it is not the EDS configuration source.

## SureSmile doctor API proxy

`cdn.yaml` routes only `GET /api/location/doctors` on
`suresmile.ynaka-adobe.com` to `https://www.suresmile.com` over HTTPS.
The path and complete query string are unchanged, including `lat`, `lng`,
`radius`, `page`, `per_page`, `unit`, and any other upstream-supported search
parameters. There is no client-controlled origin or destination path.
Other hosts, paths, and methods retain their existing routing.

The origin sends `Host: www.suresmile.com` and explicitly disables forwarding
visitor `Cookie` and `Authorization` headers. No upstream cookies, copied
browser headers, API keys, or new secrets are required. CDN caching is bypassed
so searches and pagination reach upstream. Upstream statuses and JSON responses
are passed through rather than replaced with sample results.

This uses the CDN's supported
[origin selectors](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn-configuring-traffic#origin-selectors);
no edge function or change to `edgeFunctions.yaml` is needed.

### Frontend

In the separate `ynaka-adobe/suresmile` frontend, use a root-relative URL on
the custom domain, not the upstream URL or a locale-relative `api/...` path:

```js
const params = new URLSearchParams({
  lat: '37.7813454',
  lng: '-122.497668',
  radius: '10',
  page: '1',
  per_page: '20',
  unit: 'mi',
});
const response = await fetch(`/api/location/doctors?${params}`, {
  credentials: 'omit',
});
if (!response.ok) throw new Error(`Doctor search failed: ${response.status}`);
const doctors = await response.json();
```

Keep the frontend's existing search parameters and response handling; the
example illustrates the URL change, not a new locator implementation.
Same-origin requests do not need CORS response headers. This route is not
installed on `*.aem.page` or `*.aem.live` preview hosts; use the custom domain
to demonstrate the integration.

### Deploy and verify

1. Make this commit available on the branch tracked by the existing Cloud
   Manager Edge Delivery configuration pipeline for this CDN, with source
   directory `/config-eds`. Run that pipeline in the intended environment.
   A local edit or deploying an edge function alone does not activate a
   CDN rule; the main-triggered config pipeline must succeed.
   Do not repoint the shared pipeline or change
   unrelated domains to deploy this demo.
2. Keep the existing function declarations and required Cloud Manager
   variables intact. `edgeFunctions.yaml` currently references
   `XSC_OKTA_CLIENT_SECRET` and `XSC_SESSION_SECRET`; this proxy adds none.
3. After successful deployment, compare HTTP status, `application/json`,
   pagination fields, and doctor IDs with the same upstream request:

   ```sh
   query='lat=37.7813454&lng=-122.497668&radius=10&page=1&per_page=20&unit=mi'
   curl --fail-with-body -sS -D - "https://suresmile.ynaka-adobe.com/api/location/doctors?$query"
   curl --fail-with-body -sS -D - "https://www.suresmile.com/api/location/doctors?$query"
   ```

   Repeat with `page=2` and a different `per_page`, radius, or location.
   Verify `/en-us` still loads and that another path/hostname does not
   select this origin. If the API returns an EDS HTML 404, the proxy has
   not been activated in that environment.

Focused local configuration checks (Ruby standard library, no install):

```sh
ruby test/cdn/suresmile-proxy.test.rb
```

During implementation, valid HTTPS and a 200 response at `/en-us` were
confirmed. The same-origin API still returned an EDS HTML 404; the upstream
returned 200 JSON without credentials. These observations are a
pre-deployment baseline, not evidence that the new rule is live.

## Shared visitor profile

The exact `/api/visitor-profile` path on **every domain served by this shared CDN** selects
the independent **`visitor-profile`** runtime in
`edge-functions-visitor-profile`, bypassing CDN cache for every method.
Only GET without query parameters is supported; writes return 405, lookup
parameters return 400. Other paths retain their routing. The handler
has no CUG/Okta dependencies and does not read sessions or auth secrets.
The doctor API remains a separate origin route.

### Managed coverage and naming

There is no domain allowlist or per-site frontend installation. The route,
metadata overwrite and privacy-header conditions match only the exact path.
Existing and future domains receiving this CDN configuration inherit the endpoint
without another hostname edit. The handler validates the CDN-provided hostname
rather than selecting from a hard-coded set.

The profile selector precedes the whole-site CUG selectors: this one public,
requesting-visitor endpoint does not require a login or expose auth/session data.
It does not disable authentication on any other path or replace `/auth/geo`.
No frontend Insights, Analytics, telemetry, or consent UI is installed.

Grand Design RV's actual managed domain is `granddesignrv.xsc.demo.adobe.com`,
verified as domain mapping `1620652` in program `154856` with the same function
registry as SureSmile. It receives the endpoint without installing Insights or
analytics. Existing 3M proxies, doctor search, product rewrites and site/auth
routes remain unchanged. Per user direction, inactive domains are not deployment
gates; the shared rule applies even where a domain is not currently reachable.
It does not provision missing domain mappings, certificates or function origins.
`*.aem.page`, `*.aem.live`, and `*.aem.network` are
provider-controlled origins, not endpoints controlled by these CDN rules.
Other providers and websites not served by this CDN are outside this change;
no broad CORS workaround is provided.

The source directory is `edge-functions-visitor-profile`, and the deployed
function/package name is `visitor-profile`. The inactive `dupont-persona`
registration and its homepage origin selector are retired; the obsolete
`suresmile-visitor-profile` declaration, CDN origin references and registry entry
are also retired. Registry removal can lag behind a completed configuration
pipeline, so verify absence after reconciliation rather than assuming an
immediate deletion. The installed CLI has no deletion command and the exact
named-resource DELETE returns 404; do not guess IDs or destructive endpoints.
The generic replacement
was registered and uploaded before changing the profile origin and internal
metadata names; the legacy runtime remained available until routing succeeded.
XSC remains untouched. The final declarations are `visitor-profile` and
`xsc-demo-cug`; no fourth function slot is needed.
New domains served by this shared CDN need no profile host-list update.

The CDN removes browser-supplied `x-visitor-profile-*` metadata headers
and replaces the three internal headers for this route from `domain`,
`clientIp`, and `clientCountry`. It does not use `forwardedIp`,
`X-Forwarded-For`, `Fastly-Client-IP`, or the edge function's client address
(which may identify a CDN node). All access must go through this managed CDN
configuration; do not expose a direct runtime origin that bypasses its header
sanitization. Before activation, verify that spoofed copies are overwritten
on the target CDN, including across its shielding hops.

Adobe's documented CDN properties provide IP and country, not city/coordinates.
The dedicated runtime's native
[Fastly geolocation API](https://www.fastly.com/documentation/reference/compute/sdks/javascript/js-compute/geolocation/fn.getGeolocationForIpAddress/)
looks up only the CDN-provided caller IP. No third-party service or arbitrary
IP lookup is used. City and coordinates may be unavailable, especially with
VPNs and proxies. This is approximate IP geolocation, **not GPS**.

Agreed frontend response schema:

```json
{
  "ip": null,
  "city": null,
  "region": null,
  "country": null,
  "latitude": null,
  "longitude": null,
  "source": "cdn",
  "accuracy": "unavailable"
}
```

`country` is the observed CDN two-letter country code, or the runtime's observed
country name if the CDN code is missing. Text is sanitized; unavailable or
invalid values are null. `region` is the observed Fastly country subdivision
code (short or full ISO 3166-2), not an inferred state name. It is null if
unavailable/invalid and may be absent on older runtime packages until updated.
No postal code, ASN/network, or connection fields are collected.
Coordinates are numeric, finite, within latitude
[-90, 90] / longitude [-180, 180], and emitted only as a complete pair.
When present, `accuracy` is `"approximate IP geolocation"`; no radius is invented.
A failed runtime lookup returns explicit 503 rather than a default location.

Every endpoint response, including errors, has `Cache-Control: private, no-store`
and `Surrogate-Control: no-store`; the CDN also enforces those headers.
`Surrogate-Control` is an origin-to-CDN instruction and may be consumed before
delivery to browsers; the browser-facing privacy contract is `Cache-Control:
private, no-store`.
The function holds no per-visitor state and adds no IP/geo logging, persistence,
cookies, CORS grants, or analytics forwarding. Unexpected lookup failures log
only a fixed generic message without runtime error details.
Any consuming frontend must obtain explicit profile-purpose consent, clear/abort
on withdrawal, and never forward these fields to Analytics, dataLayer, or logs.
Endpoint availability does not grant permission to collect or display a profile.
SureSmile's existing separately consented tab-session display remains compatible;
other sites need no Insights or analytics integration to make the route available.

### Deployment order and local context

Run public configuration changes and edge uploads only with approval.
The generic migration follows the runtime-first order below; a build or
upload alone does not deploy CDN configuration.

1. The confirmed intended Adobe IMS organization is **acsmarketing**, not
   AEM XSC Showcase. Verify its Cloud Manager program `154856` binding and
   the Edge Functions program/site selection independently
   of any selected App Builder project/workspace. Initial inspection found no
   Edge Functions target and a cached credential exposing only AEM XSC Showcase.
   Separately approved local sign-in subsequently verified the organization's
   full IMS name, `Adobe Customer Solutions Services Marketing`, org ID
   `21BD487E5F2280130A495ECC@AdobeOrg`, program `154856` (`demo sandbox`), and
   SureSmile domain mapping `1620193`. The isolated runtime directory now has
   a dedicated local context; its ignored `.aio` is not shared with other
   checkouts. Preserve the global App Builder context; do not switch or log
   it out to deploy this service.
   Successful authentication alone does not satisfy the runtime-before-routing
   rollout prerequisite; the deployed handler must accept any valid hostname
   supplied by this CDN rather than the older SureSmile/domain allowlist.
2. For a new registration or runtime-name migration, register the replacement
   within available capacity while retaining the serving profile origin.
   Build/package and upload the generic WASM to that verified registration using
   [the dedicated commands](../edge-functions-visitor-profile/README.md#deploy).
   Upload the generic handler **before** switching the origin and metadata
   header names; retire the old registration only after the new route succeeds.
3. Publish `/config-eds` through the existing Edge Delivery configuration
   pipeline only after approval. Main commits automatically trigger it. Keep all
   XSC declarations, auth secrets, and unrelated domain settings intact.
   A config update alone does not update the WASM, or vice versa.
4. Keep the verified shared function registration; do not deploy another package
   over CUG, consume another named-function slot, or change DNS. Per user direction,
   no inactive-domain verification is required to enable this shared route.
5. On an active custom domain, check GET JSON/schema, private/no-store
   headers, query rejection (400), non-GET rejection (405), and spoofed internal
   headers overwritten by CDN context, including shielding hops. Confirm two
   distinct visitors cannot share responses without recording their IP/location.
   Verify normal site routes and `/auth/geo` retain their existing behavior.
   Use a probe that discards response bodies; do not paste real visitor data
   into deployment logs. Review existing CDN logging policy for this path:
   this change adds no logs and cannot disable provider-managed access logs.

Do not expose a direct runtime URL to callers or claim live availability until
these provider/trust-boundary checks pass. No new secret is required.

Focused checks:

```sh
node --test edge-functions-visitor-profile/test/visitor-profile.test.mjs
ruby test/cdn/visitor-profile.test.rb
ruby test/cdn/suresmile-proxy.test.rb
```
