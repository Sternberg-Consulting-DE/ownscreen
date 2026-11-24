// Save a recording to the user's own OneDrive or Google Drive and create a
// share link. Used by the editor and by the recordings list in the menu.
import { CLOUD_PROVIDERS, configuredCloudProviderIds } from "./cloud-storage.js";

const SCOPES = [["anyone", "Jeder mit dem Link"], ["organization", "Nur meine Organisation"]];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(text, className = "button secondary") {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}

// Providers with a client ID; only these can sign in.
export async function configuredCloudProviders() {
  return (await configuredCloudProviderIds()).map(id => ({ id, name: CLOUD_PROVIDERS[id].name }));
}

export function createCloudShare({ recording, providers, api, autoProvider = null }) {
  const root = element("section", "cloud-share");
  root.setAttribute("aria-label", "Online speichern und teilen");
  const status = element("p", "cloud-status");
  status.setAttribute("role", "status");
  status.hidden = true;
  const saveButtons = element("div", "cloud-actions");
  const choice = element("div", "cloud-choice");
  choice.append(element("span", "cloud-choice-label", "Wer darf den Link öffnen?"));
  choice.hidden = true;
  const result = element("div", "cloud-result");
  const link = element("input", "cloud-link");
  link.readOnly = true;
  link.setAttribute("aria-label", "Freigabelink");
  const copy = button("Link kopieren");
  const open = element("a", "button secondary", "Im Speicher öffnen");
  open.target = "_blank"; open.rel = "noopener";
  result.append(link, copy, open);
  result.hidden = true;
  root.append(saveButtons, status, choice, result);

  let provider = null, busy = false;
  const controls = [];
  const say = (text, error = false) => { status.textContent = text; status.hidden = !text; status.classList.toggle("error", error); };
  const setBusy = value => { busy = value; for (const control of controls) control.disabled = value; };
  async function run(task) {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (error) { say(error.message, true); } finally { setBusy(false); }
  }
  function showLink(url, item) {
    link.value = url;
    open.href = item.webUrl || url;
    open.textContent = `In ${providers.find(entry => entry.id === provider)?.name || "Speicher"} öffnen`;
    result.hidden = false;
  }
  async function upload(id) {
    provider = id;
    const name = providers.find(entry => entry.id === id).name;
    say(`Wird in ${name} gespeichert…`);
    result.hidden = true;
    const { item } = await api("UPLOAD_TO_CLOUD", { id: recording.id, provider: id });
    say(`In ${name} gespeichert. Wer darf den Link öffnen?`);
    open.href = item.webUrl;
    choice.hidden = false;
  }
  for (const entry of providers) {
    const save = button(`In ${entry.name} speichern`);
    save.onclick = () => run(() => upload(entry.id));
    controls.push(save); saveButtons.append(save);
  }
  for (const [scope, label] of SCOPES) {
    const pick = button(label);
    pick.onclick = () => run(async () => {
      const { url, item } = await api("CREATE_CLOUD_LINK", { id: recording.id, provider, scope });
      showLink(url, item);
      try { await navigator.clipboard.writeText(url); say("Link erstellt und kopiert."); }
      catch { say("Link erstellt. Kopiere ihn mit „Link kopieren“."); }
    });
    controls.push(pick); choice.append(pick);
  }
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link.value); say("Link kopiert."); }
    catch { link.select(); say("Drücke ⌘ / Strg + C, um den markierten Link zu kopieren."); }
  };
  controls.push(copy);

  // Show an existing link instead of uploading again.
  const existing = providers.map(entry => [entry.id, recording.cloud?.[entry.id]]).find(([, item]) => item?.shareUrl);
  if (existing) { provider = existing[0]; showLink(existing[1].shareUrl, existing[1]); choice.hidden = false; }
  else if (autoProvider && providers.some(entry => entry.id === autoProvider)) run(() => upload(autoProvider));
  return root;
}
