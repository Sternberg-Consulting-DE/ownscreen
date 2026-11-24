// "Feedback" links open a prefilled GitHub issue form for bugs and ideas.
export const PROJECT_URL = "https://github.com/sternbj/ownscreen";

export function feedbackUrl({ version = "", browser = "" } = {}) {
  const url = new URL(`${PROJECT_URL}/issues/new`);
  url.searchParams.set("template", "feedback.yml");
  if (version) url.searchParams.set("version", version);
  if (browser) url.searchParams.set("browser", browser);
  return url.href;
}

function browserName(agent = "") {
  const chrome = agent.match(/Chrome\/(\d+)/);
  return chrome ? `Chrome ${chrome[1]}` : "";
}

export function wireFeedbackLinks(root = document) {
  const href = feedbackUrl({ version: globalThis.chrome?.runtime?.getManifest?.().version, browser: browserName(navigator.userAgent) });
  for (const link of root.querySelectorAll("a[data-feedback]")) {
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
  }
}
