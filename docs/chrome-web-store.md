# Chrome Web Store release

Capture Desk is free to download. Google requires the publisher to register, enable two-step verification, accept the developer agreement and pay the one-time developer registration fee.

1. Create an item in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Build the Store package with `npm ci`, `npm run ocr:extension` and `npm run package:store`. Upload `artifacts/Capture-Desk-Chrome-Web-Store.zip`. The manifest is at the root of the ZIP.
3. Use a clear single purpose in the listing. “Record your display, window, tab or a selected area. Edit, download and save recordings on your device or in your own online drive.” Use the listing description below.
4. Add store screenshots using synthetic recordings. Set the listing price to free and choose public visibility once ready. The [publisher guide](https://developer.chrome.com/docs/webstore/publish/) lists the required listing fields and images.
5. Complete the privacy and permission declarations for the actual package. Use the [public data-use page](https://sternbj.github.io/capture-desk/privacy.html). Explain that capture and editing are initiated by the user and that AI sends the selected image or transcript to a provider only when the user runs an action.
6. Submit for review. Use the same Store item for later releases.

| Manifest permission | Why Capture Desk uses it |
| --- | --- |
| `activeTab`, `scripting` | Capture the current tab, capture an area, and draw temporary annotations at the user's request. |
| `desktopCapture`, `tabCapture`, `offscreen` | Obtain the selected media source and capture or assemble files after the popup closes. |
| `storage` | Save recorder preferences and session state. |
| `downloads`, `clipboardWrite` | Save files or copy edited screenshots on request. |
| `contextMenus` | Provide user-invoked capture actions in the context menu. |
| `identity` | Sign in to the user's own OneDrive or Google Drive when they connect it, to save recordings and create share links there. |
| Optional provider origins | Send an explicitly selected AI request to the selected provider. |

## Listing description

> Capture Desk records your screen, a window, a Chrome tab or a selected area – with microphone, system sound and an optional camera bubble. A floating bar lets you pause and stop at any time.
>
> • Edit screenshots and trim videos right in the browser
> • Save recordings on your computer, in a folder of your choice, or in your own OneDrive or Google Drive
> • Share a link and choose who can open it: anyone with the link or only your organization
> • No account, no tracking, no ads. Recordings go directly from your browser to where you choose – never through our servers
>
> Bugs and ideas: use Feedback in the menu or https://github.com/sternbj/capture-desk/issues

## Automatic updates

For each release, increase `version` in `chrome-extension/manifest.json`. Build the ZIP, upload it under **Package → Upload new package** in the existing Store item, and submit for review. After the new release publishes, Chrome installs it automatically for people using that Store item. The ordinary unpacked development build is reloaded directly in Chrome and has its own extension identity and browser storage.

The [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) can automate package uploads and review submissions after the first manual listing. Keep any publisher credentials in your release environment. GitHub releases and Chrome Web Store releases are separate.

[Google's registration guide](https://developer.chrome.com/docs/webstore/register/) · [Update a Store item](https://developer.chrome.com/docs/webstore/update) · [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
