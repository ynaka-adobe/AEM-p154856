# Shared visitor profile edge function

Independent Fastly JavaScript runtime named **`visitor-profile`**, packaged from
`edge-functions-visitor-profile`. It replaces the SureSmile-branded function.
It imports only the native `fastly:geolocation` API and the profile handler.
There are no XSC, Okta, Adobe Analytics, origin proxy, config-store, secret-store,
or generated build-environment dependencies. **No `.env` or auth secret is
required to build this runtime.** Adobe CLI authentication is still required
to upload it.

`../config-eds/edgeFunctions.yaml` registers the function.
`../config-eds/cdn.yaml` routes the exact `/api/visitor-profile` path on every
domain served by this shared CDN to `edgefunction-visitor-profile`.
There is no hostname allowlist. The handler accepts a valid hostname only from
CDN-overwritten metadata. Provider-owned EDS origins outside this CDN are not
configured by these rules.
The shared XSC runtime source no longer contains the profile branch.
An older deployed XSC package may still contain that dormant branch until
independently rebuilt; do not redeploy XSC merely to activate this function.

## Contract and privacy

The UI path and JSON contract are unchanged:

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

GET only, no query parameters, no arbitrary IP lookup. The handler trusts only
the CDN-overwritten `x-visitor-profile-host`, `-ip`, and `-country` headers
derived from platform `domain`, `clientIp`, and `clientCountry`. It never uses
browser `X-Forwarded-For` / `Fastly-Client-IP` or the function node's address.
The global CDN sanitation removes spoofed copies even on other hosts; do not
expose this runtime through an origin bypassing that managed CDN sanitation.

Native IP geolocation may return null; numeric coordinate pairs are range
checked and labelled `"approximate IP geolocation"`, never GPS or an invented
accuracy radius. All responses (including errors and unknown routes) are
private/no-store; CDN routing skips cache. No profile storage, cookies,
cross-origin grants, third-party lookup, or sensitive logs are added.
Consumers must require explicit profile-purpose consent, clear on withdrawal,
and never forward these fields to analytics or logs. No frontend, Insights or
telemetry installation is part of the shared route. SureSmile's existing
separately consented display/tab cache remains unchanged.

`region` is an additive nullable **state/region code**, taken only from
Fastly's `geo.region` country subdivision metadata. It preserves an observed
short code (for example `CA`) or full ISO 3166-2 code (for example `US-CA`);
it is not a state name and no prefix/jurisdiction is inferred from country
or city. Invalid or unavailable codes are null. Older deployed packages may
omit `region` until this updated standalone WASM is uploaded.
The provider also supports nullable postal code, ASN/network, and connection
metadata; this endpoint intentionally does not collect or expose those fields.

See [the shared-CDN coverage and rollout boundary](../config-eds/README.md#shared-visitor-profile).

## Build and package

From this directory:

```sh
npm ci
npm test
aio aem edge-functions build
```

The manifest's build script compiles `src/index.js` to `bin/main.wasm`;
the Adobe build command packages that artifact under `pkg/`. The lockfile
pins the compiler dependencies. This artifact is independent of XSC's WASM
and contains no generated `XSC_*` configuration.

For a local compilation check only, `npm run build` produces the WASM without
uploading it. `fastly compute serve --file bin/main.wasm` runs the local runtime;
only use synthetic metadata for local tests. Local tests cannot establish
that public CDN metadata is authentic or that the live route is active.

## Deploy

Deployment changes public infrastructure; run these commands only with approval.
Main commits automatically trigger the `/config-eds` configuration pipeline.
Confirm the existing function registration before uploading.
Registration/routing and WASM upload are separate steps. The generic function is
registered as `visitor-profile`; inactive `dupont-persona` is retired. The legacy
`suresmile-visitor-profile` declaration and CDN origin references are removed,
but its package still appears in the provider registry. Physical deletion is
not confirmed: the installed CLI has no delete operation and DELETE on that
verified named resource returns 404. Use a provider-supported administrative
action for physical cleanup; do not guess IDs or alternate destructive endpoints.
For another runtime-name
migration, register and upload the replacement before switching the CDN origin
and metadata, and retire the old registration only after routing succeeds.
Preserve XSC; do not deploy this package over `xsc-demo-cug`.
Confirm the IMS org owning program `154856`; an App Builder workspace selection
does not verify Edge Functions authentication or deployment context.

Start in `edge-functions-visitor-profile`, not the archived DuPont or XSC
directories. A fresh checkout does not contain the worktree's ignored `.aio`.
Establish an approved, dedicated **local** OAuth context for **acsmarketing**:
`Adobe Customer Solutions Services Marketing`,
`21BD487E5F2280130A495ECC@AdobeOrg`. Do not copy credentials between checkouts,
reuse another organization's token, or switch global App Builder configuration.
Once that local context is configured, select and authenticate it without
printing its access token:

```sh
aio auth ctx --local --set aem-edge-acsmarketing
aio auth login --local --ctx aem-edge-acsmarketing --bare > /dev/null
```

Complete browser sign-in using the acsmarketing profile when requested.
Then select and verify the intended local target:

```sh
aio aem edge-functions setup
# Select program 154856, Edge Delivery Services,
# site 1620193: suresmile.ynaka-adobe.com.
# Store setup locally; do not change another runtime's global configuration.
aio aem edge-functions info --batch
aio aem edge-functions list
```

Verify Program ID `154856`, Edge Delivery `Yes`, and Site Domain
`suresmile.ynaka-adobe.com`. This is the verified administrative gateway to the
shared registry, not the function name or a hostname restriction. Grand Design
RV, `granddesignrv.xsc.demo.adobe.com` (site `1620652`), has the same registry
and is another verified selection. In the installed CLI, an old Environment ID is not
the EDS selector; do not replace it with the site ID. An explicit
`AEM_EDGE_FUNCTIONS_API_ENDPOINT` can override the target, so remove an unintended
override privately. Fix any ADC `invalid_client` secret mismatch privately;
never paste secrets into chat or commit `.aio`/credentials.

After `visitor-profile` is listed and the target is verified:

```sh
aio aem edge-functions build
aio aem edge-functions deploy visitor-profile --package pkg/visitor-profile.tar.gz
aio aem edge-functions packages visitor-profile --limit 1
```

The explicit `--package` selects the generic archive even if old archives
remain under `pkg/`. Building alone uploads nothing. Uploading WASM updates the
registered runtime but does not deploy CDN YAML; main's configuration pipeline
must finish separately when changing registrations or routing.
Verify JSON schema, private/no-store, query/method rejection, host/path
isolation, CDN-overwritten spoofed metadata, and separate visitors without
recording their real IP/location on an active custom domain. Per user direction,
inactive-domain verification is not a rollout gate. Keep the existing verified
shared registration; do not guess additional provider targets.
No package upload here changes `*.aem.page`/`*.aem.live` routing.
Do not claim availability until the actual custom-domain endpoints pass
these checks.
