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

## SureSmile visitor profile (pending deployment)

The exact `/api/visitor-profile` path on `suresmile.ynaka-adobe.com` selects
the independent `suresmile-visitor-profile` runtime in
`edge-functions-suresmile`, bypassing CDN cache for every method.
Only GET without query parameters is supported; writes return 405, lookup
parameters return 400. Other paths and sites retain their routing. The handler
has no CUG/Okta dependencies and does not read sessions or auth secrets.
The doctor API remains a separate origin route.

The CDN removes browser-supplied `x-suresmile-profile-*` metadata headers
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
  "country": null,
  "latitude": null,
  "longitude": null,
  "source": "cdn",
  "accuracy": "unavailable"
}
```

`country` is the observed CDN two-letter country code, or the runtime's observed
country name if the CDN code is missing. Text is sanitized; unavailable or
invalid values are null. Coordinates are numeric, finite, within latitude
[-90, 90] / longitude [-180, 180], and emitted only as a complete pair.
When present, `accuracy` is `"approximate IP geolocation"`; no radius is invented.
A failed runtime lookup returns explicit 503 rather than a default location.

Every endpoint response, including errors, has `Cache-Control: private, no-store`
and `Surrogate-Control: no-store`; the CDN also enforces those headers.
The function holds no per-visitor state and adds no IP/geo logging, persistence,
cookies, CORS grants, or analytics forwarding. Unexpected lookup failures log
only a fixed generic message without runtime error details.
The frontend must request this endpoint only after explicit profile-purpose
consent while `?insights=1` is open, clear/abort on withdrawal, and never send
these fields to Adobe Analytics, dataLayer, storage, or logs. Prior analytics
consent alone is insufficient.

The user approved the independent function migration and deployment.
Main commits automatically trigger `/config-eds`; successful configuration
deployment registers `suresmile-visitor-profile` as the third named function.
Its independent WASM must then be uploaded to the correctly selected SureSmile
site using [the dedicated build/deploy commands](../edge-functions-suresmile/README.md#deploy).
No new secret is required. Do not overwrite or deploy XSC's shared package for
this feature. Older deployed XSC packages can retain the dormant profile branch
until separately rebuilt; XSC source is restored and the new route does not
select that function.
Confirm scope, private/no-store response headers, two distinct visitors'
isolation, and spoof resistance on the actual CDN without recording their
IP/location. Do not claim this endpoint or its geo fields are live beforehand.

Focused checks:

```sh
node --test edge-functions-suresmile/test/visitor-profile.test.mjs
ruby test/cdn/visitor-profile.test.rb
```
