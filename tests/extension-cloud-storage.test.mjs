import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_BYTES, createCloudStorage } from "../chrome-extension/cloud-storage.js";

const REDIRECT = "https://extension-id.chromiumapp.org/";

function fakeChrome({ clientIds = { onedrive: "ms-client", gdrive: "google-client" }, tokens = {}, authReply } = {}) {
  const store = { cloudClientIds: clientIds, cloudTokens: tokens };
  const authRequests = [];
  return {
    store, authRequests,
    chrome: {
      runtime: { getPlatformInfo: async () => ({}) },
      storage: { local: {
        get: async key => ({ [key]: store[key] }),
        set: async values => { Object.assign(store, values); },
      } },
      identity: {
        getRedirectURL: path => REDIRECT + path,
        launchWebAuthFlow: async ({ url, interactive }) => {
          const request = new URL(url); authRequests.push({ request, interactive });
          return authReply(request, interactive);
        },
      },
    },
  };
}
function recorder(handler) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), ...options, headers: options.headers || {} });
    return handler(String(url), options, calls);
  };
  return { calls, fetch };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const valid = { accessToken: "token", expiresAt: Date.now() + 3600000 };

test("OneDrive sign-in uses PKCE and stores the refreshable token", async () => {
  const { chrome, store, authRequests } = fakeChrome({ authReply: request =>
    `${request.searchParams.get("redirect_uri")}?code=auth-code&state=${request.searchParams.get("state")}` });
  const { calls, fetch } = recorder(() => json({ access_token: "ms-access", refresh_token: "ms-refresh", expires_in: 3600 }));
  await createCloudStorage({ chrome, fetch }).connect("onedrive");
  const authorize = authRequests.find(entry => entry.interactive).request;
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("redirect_uri"), REDIRECT + "onedrive");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.ok(body.get("code_verifier").length >= 43);
  assert.equal(store.cloudTokens.onedrive.refreshToken, "ms-refresh");
});

test("an expired OneDrive token is refreshed without opening a sign-in window", async () => {
  const { chrome, authRequests } = fakeChrome({ tokens: { onedrive: { accessToken: "old", refreshToken: "refresh", expiresAt: 0 } } });
  const { calls, fetch } = recorder(url => url.endsWith("/token")
    ? json({ access_token: "fresh", expires_in: 3600 }) : json({ link: { webUrl: "https://1drv.ms/v/abc" } }));
  const url = await createCloudStorage({ chrome, fetch }).createLink("onedrive", "item1", "anyone");
  assert.equal(url, "https://1drv.ms/v/abc");
  assert.equal(authRequests.length, 0);
  assert.equal(new URLSearchParams(calls[0].body).get("grant_type"), "refresh_token");
  assert.equal(calls[1].headers.Authorization, "Bearer fresh");
  assert.deepEqual(JSON.parse(calls[1].body), { type: "view", scope: "anonymous" });
});

test("OneDrive uploads into the OwnScreen folder in aligned chunks", async () => {
  const { chrome } = fakeChrome({ tokens: { onedrive: valid } });
  const size = CHUNK_BYTES + 1000;
  const { calls, fetch } = recorder((url, options) => {
    if (url.includes("createUploadSession")) return json({ uploadUrl: "https://upload.example/session" });
    const end = Number(/-(\d+)\//.exec(options.headers["Content-Range"])[1]);
    return end + 1 === size ? json({ id: "item1", webUrl: "https://onedrive.example/item1", name: "Demo.webm" }, 201) : json({}, 202);
  });
  const item = await createCloudStorage({ chrome, fetch }).upload("onedrive", new Blob([new Uint8Array(size)], { type: "video/webm" }), "Demo.webm");
  assert.deepEqual(item, { itemId: "item1", webUrl: "https://onedrive.example/item1", name: "Demo.webm" });
  assert.match(calls[0].url, /root:\/OwnScreen\/Demo\.webm:\/createUploadSession$/);
  assert.equal(CHUNK_BYTES % (320 * 1024), 0);
  assert.deepEqual(calls.slice(1).map(call => call.headers["Content-Range"]), [`bytes 0-${CHUNK_BYTES - 1}/${size}`, `bytes ${CHUNK_BYTES}-${size - 1}/${size}`]);
  assert.equal(calls[1].headers.Authorization, undefined, "upload URLs are pre-authorized and must not receive the token");
});

test("Google Drive reuses its folder, uploads resumably and creates an anyone link", async () => {
  const { chrome } = fakeChrome({ tokens: { gdrive: valid } });
  const { calls, fetch } = recorder((url, options) => {
    if (url.includes("/files?q=")) return json({ files: [{ id: "folder1" }] });
    if (url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { Location: "https://upload.google/session" } });
    if (url === "https://upload.google/session") return json({ id: "file1", webViewLink: "https://drive.google.com/file/d/file1/view", name: "Demo.webm" });
    if (url.endsWith("/permissions")) return json({ id: "perm" });
    return json({ webViewLink: "https://drive.google.com/file/d/file1/view" });
  });
  const cloud = createCloudStorage({ chrome, fetch });
  const item = await cloud.upload("gdrive", new Blob(["abc"], { type: "video/webm" }), "Demo.webm");
  assert.equal(item.itemId, "file1");
  const start = calls.find(call => call.url.includes("uploadType=resumable"));
  assert.deepEqual(JSON.parse(start.body), { name: "Demo.webm", parents: ["folder1"], mimeType: "video/webm" });
  assert.equal(start.headers["X-Upload-Content-Length"], "3");
  assert.equal(calls.filter(call => call.method === "POST" && call.url.endsWith("/files?fields=id")).length, 0, "existing folder is reused");
  assert.equal(await cloud.createLink("gdrive", "file1", "anyone"), "https://drive.google.com/file/d/file1/view");
  assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith("/permissions")).body), { role: "reader", type: "anyone" });
});

test("Google organization links need a Workspace domain", async () => {
  const { chrome } = fakeChrome({ tokens: { gdrive: valid } });
  const personal = createCloudStorage({ chrome, fetch: recorder(() => json({ user: { emailAddress: "me@gmail.com" } })).fetch });
  await assert.rejects(personal.createLink("gdrive", "file1", "organization"), /Google-Workspace/);
  const { calls, fetch } = recorder(url => url.includes("/about") ? json({ user: { emailAddress: "me@firma.de" } }) : json({ webViewLink: "https://drive.google.com/x" }));
  await createCloudStorage({ chrome, fetch }).createLink("gdrive", "file1", "organization");
  assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith("/permissions")).body), { role: "reader", type: "domain", domain: "firma.de" });
});

test("a provider without a client ID explains where to set it up and nothing is requested", async () => {
  const { chrome, authRequests } = fakeChrome({ clientIds: {} });
  const { calls, fetch } = recorder(() => json({}));
  await assert.rejects(createCloudStorage({ chrome, fetch }).connect("gdrive"), /Einstellungen/);
  assert.equal(authRequests.length + calls.length, 0);
  const status = await createCloudStorage({ chrome, fetch }).status();
  assert.deepEqual(status.gdrive, { name: "Google Drive", configured: false, connected: false, redirectUri: REDIRECT + "gdrive" });
});

test("a forged sign-in response with the wrong state is rejected", async () => {
  const { chrome } = fakeChrome({ authReply: request => `${request.searchParams.get("redirect_uri")}#access_token=evil&state=wrong` });
  await assert.rejects(createCloudStorage({ chrome, fetch: recorder(() => json({})).fetch }).connect("gdrive"), /bestätigt/);
});
