# Sample AEM project template

This is a project template for AEM-based applications. It is intended as a best-practice set of examples as well as a potential starting point to develop your own functionality.

## Modules

The main parts of the template are:

* [core:](core/README.md) Java bundle containing all core functionality like OSGi services, listeners or schedulers, as well as component-related Java code such as servlets or request filters.
* [it.tests:](it.tests/README.md) Java based integration tests
* [ui.apps:](ui.apps/README.md) contains the /apps (and /etc) parts of the project, ie JS&CSS clientlibs, components, and templates
* [ui.content:](ui.content/README.md) contains sample content using the components from the ui.apps
* ui.config: contains runmode specific OSGi configs for the project
* [ui.frontend:](ui.frontend.general/README.md) an optional dedicated front-end build mechanism (Angular, React or general Webpack project)
* [ui.tests.cypress:](ui.tests.cypress/README.md) Cypress based UI tests
* [ui.tests.wdio:](ui.tests.wdio/README.md) Selenium based UI tests
* all: a single content package that embeds all of the compiled modules (bundles and content packages) including any vendor dependencies
* analyse: this module runs analysis on the project which provides additional validation for deploying into AEMaaCS

## EDS Adaptive Form submissions

Publish allows Forms requests from the Toyota Financial and Hitachi Energy
custom domains and their branch origins on `*.aem.page` and `*.aem.live`.
The `forms-eds` CORS policy remains scoped to `/adobe/forms/.*` and
`/content/forms/.*`, without cross-origin credentials.

The Sling ReferrerFilter is a singleton: configure
`org.apache.sling.security.impl.ReferrerFilter.cfg.json`, not a factory-suffixed
filename. Its regular expressions match `scheme://host:port`, so HTTPS branch
origins include `:443`, unlike the CORS origin expressions. The merged
configuration retains the existing Okta and localhost hosts, requires a
nonempty referrer, and keeps the existing filtered methods.
Dispatcher forwards CORS request headers and `x-adobe-form-hostname` to Publish.
The included default `/0062` filter already allows `GET|POST|OPTIONS` for
`/adobe/forms/*`; neither immutable defaults nor the default vhost need edits.

Focused configuration checks:

```sh
ruby test/forms/eds-publish.test.rb
mvn -pl ui.config,dispatcher -am verify
```

Deploy these OSGi and Dispatcher changes through the Cloud Manager **full-stack
AEM code pipeline**, not the `/config-eds` configuration pipeline. The `all`
package embeds `ui.config`; its `cloudManagerTarget=none` means the config
package is not a standalone deployment target. Before any merge or deployment,
confirm the pipeline's repository and source branch, program `154856`, and
environment `1944736` (Publish:
`https://publish-p154856-e1944736.adobeaemcloud.com`), and obtain deployment
approval. `config.publish` also applies to other Publish environments using
this code. Local checks do not establish deployment success.

The user confirmed the full-stack pipeline source as
`https://github.com/ynaka-adobe/AEM-p154856`, branch `main`, using Smart Build
Strategy. Make the approved configuration commit available on that branch
before running the pipeline; Smart Build does not consume an unpushed local
branch. There is no configured Adobe Git remote in this checkout. Confirm
the actual pipeline ID and target environment in an authorized Cloud Manager
session before execution; the source confirmation is not merge or deployment
approval.

The separate Hitachi EDS frontend must initialize its form submission base URL
to that Publish origin for workflow submissions: import `setSubmitBaseUrl` from
`blocks/form/constant.js` and call it before any form decoration with
`https://publish-p154856-e1944736.adobeaemcloud.com` (no trailing slash).
`setupForm()` then prefixes the exported `/adobe/forms/af/submit/<base64-form-path>`
action for `aemworkflowsubmit`; spreadsheet/AEP submissions keep their dedicated
service route. On November 27, 2026, read-only browser inspection of
`/forms/revised-po-order-change-request` found an empty base URL and a relative
workflow model action, so the frontend still needed that initialization.
With an absolute Publish
target, the request does not traverse the Hitachi custom-domain CUG route;
no `/config-eds/cdn.yaml` routing exception is needed. Keep the shared Okta
route unchanged. Form publication and the `po_order_change_order` workflow
setup are separate, author-managed prerequisites; this configuration does not
change either.

After deployment, verify the effective singleton ReferrerFilter and Forms CORS
policy in the Cloud Manager Developer Console and send an OPTIONS request to
the actual `/adobe/forms/af/submit/<base64-form-path>` endpoint with the EDS
Origin and requested POST headers. Require the matching
`Access-Control-Allow-Origin`, POST method, and requested headers; a 200 without
CORS headers is not a successful browser preflight. Coordinate a real
submission only after the form/workflow owner is ready.

## How to build

To build all the modules run in the project root directory the following command with Maven 3:

    mvn clean install

To build all the modules and deploy the `all` package to a local instance of AEM, run in the project root directory the following command:

    mvn clean install -PautoInstallSinglePackage

Or to deploy it to a publish instance, run

    mvn clean install -PautoInstallSinglePackagePublish

Or alternatively

    mvn clean install -PautoInstallSinglePackage -Daem.port=4503

Or to deploy only the bundle to the author, run

    mvn clean install -PautoInstallBundle

Or to deploy only a single content package, run in the sub-module directory (i.e `ui.apps`)

    mvn clean install -PautoInstallPackage

## Documentation

The build process also generates documentation in the form of README.md files in each module directory for easy reference. Depending on the options you select at build time, the content may be customized to your project.

## Testing

There are three levels of testing contained in the project:

### Unit tests

This show-cases classic unit testing of the code contained in the bundle. To
test, execute:

    mvn clean test

### Integration tests

This allows running integration tests that exercise the capabilities of AEM via
HTTP calls to its API. To run the integration tests, run:

    mvn clean verify -Plocal

Test classes must be saved in the `src/main/java` directory (or any of its
subdirectories), and must be contained in files matching the pattern `*IT.java`.

The configuration provides sensible defaults for a typical local installation of
AEM. If you want to point the integration tests to different AEM author and
publish instances, you can use the following system properties via Maven's `-D`
flag.

| Property | Description | Default value |
| --- | --- | --- |
| `it.author.url` | URL of the author instance | `http://localhost:4502` |
| `it.author.user` | Admin user for the author instance | `admin` |
| `it.author.password` | Password of the admin user for the author instance | `admin` |
| `it.publish.url` | URL of the publish instance | `http://localhost:4503` |
| `it.publish.user` | Admin user for the publish instance | `admin` |
| `it.publish.password` | Password of the admin user for the publish instance | `admin` |

The integration tests in this archetype use the [AEM Testing
Clients](https://github.com/adobe/aem-testing-clients) and showcase some
recommended [best
practices](https://github.com/adobe/aem-testing-clients/wiki/Best-practices) to
be put in use when writing integration tests for AEM.

## Static Analysis

The `analyse` module performs static analysis on the project for deploying into AEMaaCS. It is automatically
run when executing

    mvn clean install

from the project root directory. Additional information about this analysis and how to further configure it
can be found here https://github.com/adobe/aemanalyser-maven-plugin

### UI tests

They will test the UI layer of your AEM application using either Cypress or Selenium technology.

Check README file in `ui.tests.cypress` or `ui.tests.wdio` module for more details.

## ClientLibs

The frontend module is made available using an [AEM ClientLib](https://helpx.adobe.com/experience-manager/6-5/sites/developing/using/clientlibs.html). When executing the NPM build script, the app is built and the [`aem-clientlib-generator`](https://github.com/wcm-io-frontend/aem-clientlib-generator) package takes the resulting build output and transforms it into such a ClientLib.

A ClientLib will consist of the following files and directories:

- `css/`: CSS files which can be requested in the HTML
- `css.txt` (tells AEM the order and names of files in `css/` so they can be merged)
- `js/`: JavaScript files which can be requested in the HTML
- `js.txt` (tells AEM the order and names of files in `js/` so they can be merged
- `resources/`: Source maps, non-entrypoint code chunks (resulting from code splitting), static assets (e.g. icons), etc.

## Maven settings

The project comes with the auto-public repository configured. To setup the repository in your Maven settings, refer to:

    http://helpx.adobe.com/experience-manager/kb/SetUpTheAdobeMavenRepository.html
