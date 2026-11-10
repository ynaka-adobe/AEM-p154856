# Edge Delivery CDN configuration

Deploy this directory with the existing Cloud Manager **Edge Delivery
configuration pipeline**. `/config` is for the separate AEM environment
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
   A local edit, a Git push alone, or deploying an edge function does not
   activate the CDN rule. Do not repoint the shared pipeline or change
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
