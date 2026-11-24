// OneDrive and Google Drive uploads with share links. Runs in the service
// worker. Sign-in uses chrome.identity.launchWebAuthFlow, so it works with any
// Microsoft or Google account without a server of our own.
import { CLOUD_CLIENT_IDS } from "./app-config.js";

export const CLOUD_FOLDER = "Capture Desk";
// OneDrive needs multiples of 320 KiB, Google Drive multiples of 256 KiB.
// 5 MiB satisfies both and keeps each request well below their limits.
export const CHUNK_BYTES = 5 * 1024 * 1024;
export const LINK_SCOPES = ["anyone", "organization"];

const TOKENS_KEY = "cloudTokens";
const CLIENT_IDS_KEY = "cloudClientIds";
const MICROSOFT = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export const CLOUD_PROVIDERS = {
  onedrive: { name: "OneDrive", scopes: "offline_access Files.ReadWrite User.Read" },
  gdrive: { name: "Google Drive", scopes: "https://www.googleapis.com/auth/drive.file" },
};

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function pkce() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}
function requireProvider(provider) {
  if (!Object.hasOwn(CLOUD_PROVIDERS, provider)) throw new Error("Unbekannter Online-Speicher.");
  return CLOUD_PROVIDERS[provider];
}
async function failure(response, fallback) {
  let detail = "";
  try { const body = await response.json(); detail = body.error?.message || body.error_description || (typeof body.error === "string" ? body.error : ""); } catch { /* not JSON */ }
  return new Error(`${fallback}${detail ? ` (${detail})` : ""}`);
}

async function readClientId(storage, provider) {
  const stored = (await storage.get(CLIENT_IDS_KEY))[CLIENT_IDS_KEY] || {};
  return String(stored[provider] || CLOUD_CLIENT_IDS?.[provider] || "").trim();
}
// Providers that can sign in: a client ID is built in or entered in the settings.
export async function configuredCloudProviderIds(chrome = globalThis.chrome) {
  const ids = await Promise.all(Object.keys(CLOUD_PROVIDERS).map(async provider => (await readClientId(chrome.storage.local, provider)) ? provider : null));
  return ids.filter(Boolean);
}
export async function saveCloudClientId(provider, value, chrome = globalThis.chrome) {
  if (!Object.hasOwn(CLOUD_PROVIDERS, provider)) throw new Error("Unbekannter Online-Speicher.");
  const stored = (await chrome.storage.local.get(CLIENT_IDS_KEY))[CLIENT_IDS_KEY] || {};
  stored[provider] = String(value || "").trim().slice(0, 200);
  await chrome.storage.local.set({ [CLIENT_IDS_KEY]: stored });
}

export function createCloudStorage({ chrome = globalThis.chrome, fetch = globalThis.fetch.bind(globalThis), keepAlive = () => chrome.runtime.getPlatformInfo?.() } = {}) {
  const storage = chrome.storage.local;

  const clientId = provider => readClientId(storage, provider);
  async function tokens() { return (await storage.get(TOKENS_KEY))[TOKENS_KEY] || {}; }
  async function saveToken(provider, token) {
    const all = await tokens();
    if (token) all[provider] = token; else delete all[provider];
    await storage.set({ [TOKENS_KEY]: all });
  }
  function redirectUri(provider) { return chrome.identity.getRedirectURL(provider); }

  async function authorize(provider, interactive) {
    const id = await clientId(provider);
    if (!id) throw new Error(`${CLOUD_PROVIDERS[provider].name} ist noch nicht eingerichtet. Trage die Client-ID unter Einstellungen → Online-Speicher ein.`);
    const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    const url = new URL(provider === "onedrive" ? `${MICROSOFT}/authorize` : GOOGLE_AUTH);
    const params = { client_id: id, redirect_uri: redirectUri(provider), scope: CLOUD_PROVIDERS[provider].scopes, state };
    let verifier;
    if (provider === "onedrive") {
      const codes = await pkce(); verifier = codes.verifier;
      Object.assign(params, { response_type: "code", code_challenge: codes.challenge, code_challenge_method: "S256", prompt: interactive ? "select_account" : "none" });
    } else Object.assign(params, { response_type: "token", include_granted_scopes: "true", ...(interactive ? {} : { prompt: "none" }) });
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const returned = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
    if (!returned) throw new Error("Die Anmeldung wurde abgebrochen.");
    const result = new URL(returned);
    const values = new URLSearchParams(provider === "onedrive" ? result.search : result.hash.slice(1));
    if (values.get("error")) throw new Error(values.get("error_description") || values.get("error"));
    if (values.get("state") !== state) throw new Error("Die Anmeldung konnte nicht bestätigt werden.");
    if (provider === "gdrive") {
      const token = { accessToken: values.get("access_token"), expiresAt: Date.now() + (Number(values.get("expires_in")) || 3600) * 1000 };
      if (!token.accessToken) throw new Error("Google hat keinen Zugriff erteilt.");
      await saveToken(provider, token);
      return token;
    }
    return microsoftToken({ grant_type: "authorization_code", code: values.get("code"), code_verifier: verifier, redirect_uri: redirectUri(provider) });
  }
  async function microsoftToken(grant) {
    const body = new URLSearchParams({ client_id: await clientId("onedrive"), scope: CLOUD_PROVIDERS.onedrive.scopes, ...grant });
    const response = await fetch(`${MICROSOFT}/token`, { method: "POST", body });
    if (!response.ok) throw await failure(response, "Die Microsoft-Anmeldung ist fehlgeschlagen.");
    const json = await response.json();
    const token = { accessToken: json.access_token, refreshToken: json.refresh_token || grant.refresh_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
    await saveToken("onedrive", token);
    return token;
  }
  async function accessToken(provider, { interactive = true } = {}) {
    requireProvider(provider);
    const token = (await tokens())[provider];
    if (token?.accessToken && token.expiresAt > Date.now() + 60000) return token.accessToken;
    if (provider === "onedrive" && token?.refreshToken) {
      try { return (await microsoftToken({ grant_type: "refresh_token", refresh_token: token.refreshToken })).accessToken; }
      catch { await saveToken(provider, null); }
    }
    try { return (await authorize(provider, false)).accessToken; }
    catch (error) { if (!interactive) throw error; }
    return (await authorize(provider, true)).accessToken;
  }
  async function call(provider, url, options = {}, message = "Der Online-Speicher hat die Anfrage abgelehnt.") {
    const token = await accessToken(provider);
    const headers = { Authorization: `Bearer ${token}`, ...(options.json ? { "Content-Type": "application/json" } : {}), ...options.headers };
    const response = await fetch(url, { ...options, headers, body: options.json ? JSON.stringify(options.json) : options.body });
    if (!response.ok) throw await failure(response, message);
    return response;
  }
  async function sendChunks(uploadUrl, blob, { headers = {}, done }) {
    for (let start = 0; start < blob.size; start += CHUNK_BYTES) {
      const end = Math.min(blob.size, start + CHUNK_BYTES);
      // Any extension API call keeps the service worker alive between chunks.
      await keepAlive();
      const response = await fetch(uploadUrl, { method: "PUT", headers: { ...headers, "Content-Range": `bytes ${start}-${end - 1}/${blob.size}` }, body: blob.slice(start, end) });
      if (end === blob.size) {
        if (!response.ok) throw await failure(response, "Der Upload ist fehlgeschlagen.");
        return done(await response.json());
      }
      if (!response.ok && response.status !== 308) throw await failure(response, "Der Upload wurde unterbrochen.");
    }
    throw new Error("Die Datei ist leer.");
  }

  async function uploadOneDrive(blob, filename) {
    const path = `${encodeURIComponent(CLOUD_FOLDER)}/${encodeURIComponent(filename)}`;
    const session = await (await call("onedrive", `${GRAPH}/me/drive/root:/${path}:/createUploadSession`, {
      method: "POST", json: { item: { "@microsoft.graph.conflictBehavior": "rename" } } }, "OneDrive konnte den Upload nicht starten.")).json();
    return sendChunks(session.uploadUrl, blob, { done: item => ({ itemId: item.id, webUrl: item.webUrl, name: item.name }) });
  }
  async function driveFolder() {
    const query = `name='${CLOUD_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = await (await call("gdrive", `${DRIVE}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`)).json();
    if (found.files?.[0]?.id) return found.files[0].id;
    const created = await (await call("gdrive", `${DRIVE}/files?fields=id`, { method: "POST",
      json: { name: CLOUD_FOLDER, mimeType: "application/vnd.google-apps.folder" } }, "Der Ordner in Google Drive konnte nicht angelegt werden.")).json();
    return created.id;
  }
  async function uploadDrive(blob, filename) {
    const parent = await driveFolder();
    const start = await call("gdrive", `${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,webViewLink`, {
      method: "POST", json: { name: filename, parents: [parent], mimeType: blob.type || "application/octet-stream" },
      headers: { "X-Upload-Content-Type": blob.type || "application/octet-stream", "X-Upload-Content-Length": String(blob.size) },
    }, "Google Drive konnte den Upload nicht starten.");
    const uploadUrl = start.headers.get("Location");
    if (!uploadUrl) throw new Error("Google Drive hat keine Upload-Adresse geliefert.");
    return sendChunks(uploadUrl, blob, { done: item => ({ itemId: item.id, webUrl: item.webViewLink, name: item.name }) });
  }

  async function createLink(provider, itemId, scope) {
    if (!LINK_SCOPES.includes(scope)) throw new Error("Wähle, wer den Link öffnen darf.");
    if (provider === "onedrive") {
      const response = await call("onedrive", `${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/createLink`, {
        method: "POST", json: { type: "view", scope: scope === "anyone" ? "anonymous" : "organization" },
      }, scope === "anyone"
        ? "OneDrive erlaubt für dieses Konto keine öffentlichen Links. Wähle „Nur meine Organisation“."
        : "OneDrive erlaubt Organisationslinks nur für Geschäfts- oder Schulkonten.");
      return (await response.json()).link.webUrl;
    }
    const id = encodeURIComponent(itemId);
    let permission = { role: "reader", type: "anyone" };
    if (scope === "organization") {
      const about = await (await call("gdrive", `${DRIVE}/about?fields=user(emailAddress)`)).json();
      const domain = String(about.user?.emailAddress || "").split("@")[1];
      if (!domain || domain === "gmail.com" || domain === "googlemail.com")
        throw new Error("Organisationslinks gibt es nur mit einem Google-Workspace-Konto. Wähle „Jeder mit dem Link“.");
      permission = { role: "reader", type: "domain", domain };
    }
    await call("gdrive", `${DRIVE}/files/${id}/permissions`, { method: "POST", json: permission }, "Google Drive konnte die Freigabe nicht setzen.");
    return (await (await call("gdrive", `${DRIVE}/files/${id}?fields=webViewLink`)).json()).webViewLink;
  }

  return {
    async status() {
      const all = await tokens();
      return Object.fromEntries(await Promise.all(Object.keys(CLOUD_PROVIDERS).map(async provider =>
        [provider, { name: CLOUD_PROVIDERS[provider].name, configured: Boolean(await clientId(provider)), connected: Boolean(all[provider]), redirectUri: redirectUri(provider) }])));
    },
    // An explicit connect always shows the account chooser.
    async connect(provider) { requireProvider(provider); await authorize(provider, true); },
    async disconnect(provider) { requireProvider(provider); await saveToken(provider, null); },
    async upload(provider, blob, filename) {
      requireProvider(provider);
      if (!blob?.size) throw new Error("Die Aufnahme ist leer.");
      return provider === "onedrive" ? uploadOneDrive(blob, filename) : uploadDrive(blob, filename);
    },
    async createLink(provider, itemId, scope) { requireProvider(provider); return createLink(provider, itemId, scope); },
  };
}
