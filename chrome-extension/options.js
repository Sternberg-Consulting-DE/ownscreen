import { defaultPreferences, normalizePreferences, safeDownloadDirectory, updateCapturePreferences, updatePreferences } from "./preferences.js";
import { clearRecordingFolder, getRecordingFolder, pickRecordingFolder } from "./recording-folder.js";
import { screenshotSaveDestination } from "./capture-core.js";
import { initializeTheme, setTheme } from "./theme.js";
import { APP_ORIGIN } from "./app-config.js";
import { openAssistant } from "./assist-panel.js";
import { enableLanguagePicker } from "./i18n.js";
import { CLOUD_PROVIDERS, saveCloudClientId } from "./cloud-storage.js";
import { wireFeedbackLinks } from "./feedback.js";

const $ = id => document.getElementById(id);
const form = $("preferencesForm");
$("libraryButton").hidden = !APP_ORIGIN;
wireFeedbackLinks();
$("assistantButton").onclick = () => openAssistant();
enableLanguagePicker($("uiLanguage")).catch(() => {});
let busy = false;
let recordingFolder;
const themeReady = initializeTheme({ onChange: ({ preference }) => { $("theme").value = preference; } }).catch(() => null);

function status(text = "", error = false) {
  $("saveStatus").textContent = text;
  $("saveStatus").dataset.error = String(error);
}
function fill(preferences, capture = {}) {
  for (const key of Object.keys(defaultPreferences)) {
    const input = $(key);
    if (input.type === "checkbox") input.checked = preferences[key];
    else input.value = String(preferences[key]);
  }
  $("countdown").value = String([0, 3, 5, 10].includes(Number(capture.countdown)) ? Number(capture.countdown) : 3);
  const seconds = Number(capture.autoStopSeconds);
  $("autoStopMinutes").value = Number.isFinite(seconds) && seconds > 0 ? String(Number((Math.min(21600, seconds) / 60).toFixed(2))) : "0";
  $("microphoneReminder").checked = capture.microphoneReminder !== false;
}
function readPreferences() {
  return normalizePreferences(Object.fromEntries(Object.keys(defaultPreferences).map(key => {
    const input = $(key);
    return [key, input.type === "checkbox" ? input.checked : input.value];
  })));
}
async function api(type, values = {}) {
  const result = await chrome.runtime.sendMessage({ target: "background", type, ...values });
  if (!result?.ok) throw new Error(result?.error || "Die Funktion konnte nicht geöffnet werden.");
  return result;
}
function setBusy(value) {
  busy = value;
  for (const control of form.querySelectorAll("button, input, select")) control.disabled = value;
  $("saveButton").textContent = value ? "Speichern…" : "Speichern";
}
function showFolder(folder) {
  recordingFolder = folder;
  const name = folder?.name;
  $("recordingFolderName").textContent = name || "Kein Ordner ausgewählt.";
  $("chooseRecordingFolder").textContent = name ? "Ordner ändern" : "Ordner auswählen";
  $("removeRecordingFolder").hidden = !name;
  $("grantRecordingFolder").hidden = true;
}
function folderStatus(text = "", error = false) {
  $("recordingFolderStatus").textContent = text;
  $("recordingFolderStatus").dataset.error = String(error);
}
async function setFolderDestination(selected) {
  const { captureSettings = {} } = await chrome.storage.local.get("captureSettings");
  const wasSelected = captureSettings.saveDestination === "folder";
  if (wasSelected === selected) return;
  const settings = { ...captureSettings, saveDestination: selected ? "folder" : "local" };
  if (selected && !settings.screenshotDestination)
    settings.screenshotDestination = screenshotSaveDestination(captureSettings);
  await chrome.storage.local.set({ captureSettings: settings });
}
async function removeFolder() {
  await setFolderDestination(false);
  await clearRecordingFolder();
  showFolder(null);
}
$("grantRecordingFolder").addEventListener("click", async () => {
  if (busy || !recordingFolder) return;
  setBusy(true);
  let granted = false;
  try {
    // Ask directly from the click, while Chrome still sees a user gesture.
    granted = await recordingFolder.requestPermission?.({ mode: "readwrite" }) === "granted";
  } catch { /* An expired handle can still be replaced through the chooser. */ }
  $("grantRecordingFolder").hidden = granted;
  folderStatus(granted ? "Schreibzugriff erlaubt."
    : "Chrome hat den Schreibzugriff nicht erteilt. Wähle den Ordner über „Ordner ändern“ erneut aus.", !granted);
  setBusy(false);
});
$("chooseRecordingFolder").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  folderStatus();
  let name;
  try {
    name = await pickRecordingFolder();
    if (!name) return;
    showFolder(await getRecordingFolder());
    await setFolderDestination(true);
    folderStatus("Neue Videos werden in diesem Ordner gespeichert.");
  } catch (error) {
    if (error.name !== "AbortError") folderStatus(name
      ? "Der Ordner wurde ausgewählt. Der Speicherort für neue Videos konnte nicht aktiviert werden."
      : error.message || "Der Ordner konnte nicht ausgewählt werden.", true);
  } finally { setBusy(false); }
});
$("removeRecordingFolder").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  try {
    await removeFolder();
    folderStatus("Ordnerauswahl aufgehoben.");
  } catch (error) { folderStatus(error.message || "Die Ordnerauswahl konnte nicht aufgehoben werden.", true); }
  finally { setBusy(false); }
});
async function save(preferences, capture, resetFolder = false) {
  if (busy) return;
  setBusy(true);
  try {
    const normalized = await updatePreferences(chrome.storage.local, preferences);
    const recording = await updateCapturePreferences(chrome.storage.local, capture);
    fill(normalized, recording);
    if (resetFolder) {
      await removeFolder();
      folderStatus();
    }
    status("Gespeichert.");
  } catch (error) { status(error.message || "Die Einstellungen konnten nicht gespeichert werden.", true); }
  finally { setBusy(false); }
}
form.addEventListener("submit", event => {
  event.preventDefault();
  const directory = $("downloadDirectory").value.trim();
  $("downloadDirectory").setCustomValidity(directory && !safeDownloadDirectory(directory)
    ? "Gib einen Unterordner ohne Laufwerk, führenden Schrägstrich oder .. an." : "");
  if (!form.reportValidity()) return;
  save(readPreferences(), {
    countdown: Number($("countdown").value),
    autoStopSeconds: Number($("autoStopMinutes").value) * 60,
    microphoneReminder: $("microphoneReminder").checked,
  });
});
form.addEventListener("input", () => {
  $("downloadDirectory").setCustomValidity("");
  status("Noch nicht gespeichert.");
});
$("theme").addEventListener("change", () => setTheme($("theme").value)
  .then(() => status("Darstellung gespeichert."))
  .catch(error => status(error.message || "Die Darstellung konnte nicht gespeichert werden.", true)));
$("resetButton").addEventListener("click", () => save(defaultPreferences, { countdown: 3, autoStopSeconds: 0, microphoneReminder: true }, true));
$("shortcutsButton").addEventListener("click", () => api("OPEN_SHORTCUTS").catch(error => status(error.message, true)));
$("libraryButton").addEventListener("click", () => api("OPEN_LIBRARY").catch(error => status(error.message, true)));

function cloudBlock(id, provider) {
  const block = document.createElement("section");
  block.className = "recording-folder wide cloud-provider";
  block.innerHTML = `<h3></h3><p class="cloud-state"></p><div class="folder-actions"><button type="button" data-action="connect"></button><button type="button" data-action="disconnect" hidden>Trennen</button></div>
    <details><summary>Eigene App-ID verwenden (für Entwickler)</summary><label class="field"><span>Client-ID</span><input type="text" autocomplete="off" spellcheck="false"></label>
    <small>Weiterleitungs-URI für die App-Registrierung: <code class="cloud-redirect"></code></small><div class="folder-actions"><button type="button" data-action="save-id">App-ID speichern</button></div></details>
    <p class="cloud-message" role="status" aria-live="polite"></p>`;
  block.querySelector("h3").textContent = provider.name;
  block.querySelector('[data-action="connect"]').textContent = `Mit ${provider.name} verbinden`;
  block.querySelector(".cloud-redirect").textContent = provider.redirectUri;
  block.querySelector(".cloud-state").textContent = !provider.configured
    ? "Noch nicht eingerichtet. Diese Version enthält keine App-ID für diesen Dienst."
    : provider.connected ? "Verbunden. Videos werden in den Ordner „Capture Desk“ gespeichert." : "Nicht verbunden.";
  block.querySelector('[data-action="connect"]').disabled = !provider.configured;
  block.querySelector('[data-action="disconnect"]').hidden = !provider.connected;
  const say = (text, error = false) => { const node = block.querySelector(".cloud-message"); node.textContent = text; node.dataset.error = String(error); };
  const run = task => async () => { try { await task(); } catch (error) { say(error.message, true); } };
  block.querySelector('[data-action="connect"]').onclick = run(async () => { say("Anmeldefenster ist geöffnet…"); renderCloud((await api("CLOUD_CONNECT", { provider: id })).providers); });
  block.querySelector('[data-action="disconnect"]').onclick = run(async () => renderCloud((await api("CLOUD_DISCONNECT", { provider: id })).providers));
  block.querySelector('[data-action="save-id"]').onclick = run(async () => {
    await saveCloudClientId(id, block.querySelector("input").value);
    renderCloud((await api("CLOUD_STATUS")).providers);
  });
  return block;
}
function renderCloud(providers) {
  $("cloudProviders").replaceChildren(...Object.keys(CLOUD_PROVIDERS).map(id => cloudBlock(id, providers[id])));
}
setBusy(true);
try {
  await themeReady;
  const values = await chrome.storage.local.get(["recorderPreferences", "captureSettings"]);
  fill(normalizePreferences(values.recorderPreferences), values.captureSettings);
  try {
    showFolder(await getRecordingFolder());
    if (recordingFolder) {
      let permission;
      try { permission = await recordingFolder.queryPermission?.({ mode: "readwrite" }); }
      catch { /* The saved handle may need to be authorized or selected again. */ }
      $("grantRecordingFolder").hidden = permission === "granted";
    }
  }
  catch { folderStatus("Der gespeicherte Aufnahmeordner konnte nicht geladen werden.", true); }
} catch (error) { status(error.message || "Die Einstellungen konnten nicht geladen werden.", true); }
finally { setBusy(false); }
// After setBusy(false), so unconfigured providers stay disabled.
api("CLOUD_STATUS").then(result => renderCloud(result.providers)).catch(error => status(error.message, true));
