# SAML Configuration for Okta + AEM (Publish)

This folder contains the Okta IdP certificate and setup instructions for SAML SSO with Adobe Experience Manager **publish** instance.

## Files

- **okta-idp-certificate.pem** – Okta IdP signing certificate (from metadata)
- **README.md** – This setup guide

## Okta Metadata Summary

From your Okta SAML metadata:

| Property | Value |
|----------|-------|
| Entity ID | `http://www.okta.com/exk1111gb2iOAjAaA698` |
| SSO URL (POST) | `https://trial-5076725.okta.com/app/trial-5076725_assetsharedev_1/exk1111gb2iOAjAaA698/sso/saml` |
| SSO URL (Redirect) | Same as above |
| NameID Formats | `emailAddress`, `unspecified` |

## Setup Steps

### 1. Add Okta Certificate to AEM Trust Store

1. Go to **Global Trust Store** on the **publish** instance: `http://localhost:4503/libs/granite/security/content/truststore.html`
2. Create the Trust Store if needed (set and remember the password)
3. Click **Add Certificate from CER file**
4. Convert the PEM to CER if required:
   ```bash
   openssl x509 -in okta-idp-certificate.pem -outform DER -out okta-idp-certificate.cer
   ```
5. Upload the certificate and note the **alias** (e.g. `okta-idp-cert` or `1`)

### 2. Update SAML Handler Config

Edit `ui.config/.../config.publish/com.adobe.granite.auth.saml.SamlAuthenticationHandler~okta.cfg.json`:

- **idpCertAlias** – Use the alias from step 1
- **keyStorePassword** – Trust Store password
- **serviceProviderEntityId** – Your publish host (e.g. `localhost:4503` or your publish domain)
- **defaultRedirectUrl** – Where to redirect after login (e.g. `/content/demosandbox/us/en.html`)

### 3. Configure Okta Application

In the Okta Admin Console, configure your SAML app:

- **SAML Recipient / ACS URL**: `http://localhost:4503/saml_login` (or your publish URL + `/saml_login`)
- **SAML Audience**: Your publish host without protocol (e.g. `localhost:4503`)
- **Name ID**: Email
- **Attributes**: Map `email` (and optionally `firstName`, `lastName`) for user profile sync

### 4. Deploy and Test

1. Build and deploy the `ui.config` package
2. Log out of AEM
3. Access the publish instance – you should be redirected to Okta for login

## Troubleshooting

- **Referrer Filter**: The Okta host (`trial-5076725.okta.com`) is already in the Referrer Filter config
- **Debug logging**: Create an Apache Sling Logging Logger for `com.adobe.granite.auth.saml` at DEBUG level
- **Certificate alias**: Must match exactly between Trust Store and `idpCertAlias`
