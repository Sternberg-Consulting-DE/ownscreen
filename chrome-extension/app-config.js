// The public extension records and exports independently of a web service.
// Private deployments may supply a companion origin when building a package.
export const APP_ORIGIN = "";
// OAuth client IDs for OneDrive and Google Drive. Builds can set them with
// CAPTURE_DESK_ONEDRIVE_CLIENT_ID / CAPTURE_DESK_GDRIVE_CLIENT_ID; users can
// also enter their own under Settings → Online storage.
export const CLOUD_CLIENT_IDS = { onedrive: "", gdrive: "" };
