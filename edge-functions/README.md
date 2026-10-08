# DuPont Edge Functions

Imported from `ynaka-adobe/dupont` at commit
`dd747768f1a7d2501661e8ea571309d76994233d`.

The runtime resolves persona, login state, and region from the `p`, `li`, and
`region` query parameters or the `demoProfile` cookie. It calls Adobe Target's
Delivery API, injects offers into HTML slots or text tokens, and persists profile
and Target cookies. When Target fails or supplies no matching offer, it inserts
a persona banner. This is not the geolocation function described by the source
repository's outdated README.

## Configuration

EDS configuration lives in this repository's root `config-eds` directory:

- `../config-eds/edgeFunctions.yaml` declares `my-edge-function`.
- `../config-eds/cdn.yaml` routes only the homepage (`/`) on the exact domain
  `dupont.ynaka-adobe.com` to this function, alongside the existing Toyota
  Financial `.html` rewrite. Other paths and domains do not select this function
  through this rule. All four personas remain available on the homepage.

The CDN configuration also includes 3M's HTML rewrite and domain-scoped `/mmm`
reverse proxy, with optional two-letter language prefixes.

The existing `../config/api.yaml` remains for an AEM environment configuration
pipeline. Do not include it in an EDS pipeline: an `EDGE` environment rejects
the `API` configuration kind.

The runtime and `fastly.toml` retain DuPont's source settings:

- Target client: `acsmarketing`; mbox: `target-slot-hero`.
- Target context URL: `https://www.dupont.com` plus the request path.
- Content origin: `https://main--<first-host-label>--ynaka-adobe.aem.live`.
- Local backends: DuPont's EDS site and the `acsmarketing` Target endpoint.

The runtime uses dynamic backends. Its host-derived origin assumes a host such
as `dupont.ynaka-adobe.com`; localhost will not resolve to the intended EDS site.
For local requests, send `Host: dupont.ynaka-adobe.com`. The Fastly service ID is
intentionally empty. Do not add unscoped routing rules in a shared environment.

## Build

From this directory:

```sh
npm install
npm run build
```

This produces `bin/main.wasm`. Build output, installed dependencies, and local
Adobe CLI credentials are ignored. Dependencies and scripts match the source;
the source provides no Mocha tests, so `npm test` is not a verification suite yet.
The historical `chk.mjs` copy is not used by the runtime or build and is omitted.

## Deploy

Install Adobe's CLI and Edge Functions plugin, then authenticate to the intended
Adobe organization and environment:

```sh
npm install -g @adobe/aio-cli
aio plugins:install @adobe/aio-cli-plugin-aem-edge-functions
aio login
aio aem edge-functions setup
```

Point the Cloud Manager EDS configuration pipeline at `/config-eds`, not `/config`,
and deploy the CDN and function declaration. From this directory, use the
authenticated Edge Functions CLI to build and deploy the declared function:

```sh
aio aem edge-functions build
aio aem edge-functions deploy my-edge-function
aio aem edge-functions tail-logs my-edge-function
```

Deployment requires the AEM Administrator product profile and the intended
environment's setup. Importing or building this project does not deploy it.
