// Two-step confirmation without native dialogs, which can close the toolbar
// popup. The first click arms the button, a second click within the timeout runs it.
export function confirmingClick(button, run, { prompt = "Wirklich löschen?", timeout = 4000 } = {}) {
  const label = button.textContent;
  let timer;
  const disarm = () => { clearTimeout(timer); delete button.dataset.armed; button.textContent = label; };
  return async () => {
    if (button.dataset.armed !== "true") {
      button.dataset.armed = "true";
      button.textContent = prompt;
      timer = setTimeout(disarm, timeout);
      return;
    }
    disarm();
    await run();
  };
}
