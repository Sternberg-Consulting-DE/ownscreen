# Online storage setup (OneDrive and Google Drive)

OwnScreen saves recordings directly from the browser into each user's own
OneDrive or Google Drive. There is no server in between. You register the app
once with Microsoft and Google; every user then only signs in.

## 0. Fix the extension ID first

Microsoft and Google only accept sign-ins from the exact redirect address,
and that address contains the extension ID.

1. Create a Chrome Web Store developer account (one-time 5 USD).
2. Build the store package: `npm run package:extension:store`.
3. Upload `artifacts/OwnScreen-Chrome-Web-Store.zip` as a **draft** (do not publish yet).
4. In the dashboard open **Package → View public key**. Copy the key into
   `chrome-extension/manifest.json` as `"key": "<public key>"`. Your unpacked
   test version now has the same ID as the store version.
5. Load the unpacked extension, open **Settings → Online storage → Use your own
   app ID** and note the two redirect URIs, for example
   `https://<extension-id>.chromiumapp.org/onedrive` and
   `https://<extension-id>.chromiumapp.org/gdrive`.

## 1. Microsoft (OneDrive)

1. Open <https://entra.microsoft.com> → **App registrations → New registration**.
2. Name: `OwnScreen`.
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
4. Redirect URI: platform **Single-page application (SPA)**, value
   `https://<extension-id>.chromiumapp.org/onedrive`.
   SPA is required: the extension exchanges the sign-in code from the browser (PKCE, no secret).
5. Register, then copy the **Application (client) ID**.
6. **API permissions**: check that Microsoft Graph `Files.ReadWrite`, `User.Read`
   and `offline_access` (delegated) are listed. Add them if missing. No admin consent needed.
7. Optional but recommended for company users: **Branding & properties → Publisher
   verification** (free, needs a Microsoft Partner Network ID). Without it, some
   companies show "admin approval required".

## 2. Google (Google Drive)

1. Open <https://console.cloud.google.com> → create project `OwnScreen`.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **OAuth consent screen** (Google Auth Platform): External, app name, support
   email, logo, homepage, privacy policy URL `https://sternbj.github.io/ownscreen/privacy.html`.
   Scope: `.../auth/drive.file` only. This scope only sees files the app creates
   and is not a restricted scope, so no security audit is required.
4. **Clients → Create client** → type **Web application**. Authorized redirect URI:
   `https://<extension-id>.chromiumapp.org/gdrive`. Copy the **Client ID**.
5. While the app is in **Testing**, add your own Google account as a test user.
   Before release click **Publish app**; Google then checks the branding
   (usually a few days).

## 3. Test with your IDs

Paste both client IDs under **Settings → Online storage → Use your own app ID**,
click **Connect**, record a short video with save target **OneDrive** or
**Google Drive**, and create a link in the editor.

## 4. Build the store version with the IDs inside

```sh
CAPTURE_DESK_ONEDRIVE_CLIENT_ID=<microsoft-client-id> \
CAPTURE_DESK_GDRIVE_CLIENT_ID=<google-client-id> \
npm run package:extension:store
```

Upload the new zip to the draft and submit it for review. In the store listing,
declare that the extension handles "website content" (recordings) and link the
privacy policy.
