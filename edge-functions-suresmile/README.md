# SureSmile visitor profile edge function

Independent Fastly JavaScript runtime named `suresmile-visitor-profile`.
It imports only the native `fastly:geolocation` API and the profile handler.
There are no XSC, Okta, Adobe Analytics, origin proxy, config-store, secret-store,
or generated build-environment dependencies. **No `.env` or auth secret is
required to build this runtime.** Adobe CLI authentication is still required
to upload it.

`../config-eds/edgeFunctions.yaml` registers the function.
`../config-eds/cdn.yaml` routes only the exact SureSmile custom-domain
`/api/visitor-profile` path to `edgefunction-suresmile-visitor-profile`.
The shared XSC runtime source no longer contains the profile branch.
An older deployed XSC package may still contain that dormant branch until
independently rebuilt; do not redeploy XSC merely to activate this function.

## Contract and privacy

The UI path and JSON contract are unchanged:

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

GET only, no query parameters, no arbitrary IP lookup. The handler trusts only
the CDN-overwritten `x-suresmile-profile-host`, `-ip`, and `-country` headers
derived from platform `domain`, `clientIp`, and `clientCountry`. It never uses
browser `X-Forwarded-For` / `Fastly-Client-IP` or the function node's address.
The global CDN sanitation removes spoofed copies even on other hosts; do not
expose this runtime through an origin bypassing that managed CDN sanitation.

Native IP geolocation may return null; numeric coordinate pairs are range
checked and labelled `"approximate IP geolocation"`, never GPS or an invented
accuracy radius. All responses (including errors and unknown routes) are
private/no-store; CDN routing skips cache. No profile storage, cookies,
cross-origin grants, third-party lookup, or sensitive logs are added.
The UI must require explicit profile-purpose consent and `?insights=1`,
clear on withdrawal, and never send these fields to analytics or storage.

See [the full CDN contract](../config-eds/README.md#suresmile-visitor-profile-pending-deployment).

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

Main commits automatically trigger the `/config-eds` configuration pipeline
in this program. Confirm that it registers this new name before uploading.
Registration/routing and WASM upload are separate steps.

In this runtime's directory, select and verify the intended target:

```sh
aio aem edge-functions setup
# Select program 154856, Edge Delivery Services,
# site 1620193: suresmile.ynaka-adobe.com.
# Store setup locally; do not change another runtime's global configuration.
aio aem edge-functions info --batch
```

Verify Program ID `154856`, Edge Delivery `Yes`, and Site Domain
`suresmile.ynaka-adobe.com`. In the installed CLI, an old Environment ID is not
the EDS selector; do not replace it with the site ID. An explicit
`AEM_EDGE_FUNCTIONS_API_ENDPOINT` can override the target, so remove an unintended
override privately. Fix any ADC `invalid_client` secret mismatch privately;
never paste secrets into chat or commit `.aio`/credentials.

After the new function is registered and the target is verified:

```sh
aio aem edge-functions build
aio aem edge-functions deploy suresmile-visitor-profile
aio aem edge-functions packages suresmile-visitor-profile --limit 1
```

Do not deploy `xsc-demo-cug` for this feature. The deploy command discovers the
new runtime's packaged artifact under `pkg/`.
Verify JSON schema, private/no-store, query/method rejection, host/path
isolation, CDN-overwritten spoofed metadata, and separate visitors without
recording their real IP/location. The split alone is not proof that the previous
live 404 is fixed; do not claim availability until the custom-domain endpoint
passes those checks.
