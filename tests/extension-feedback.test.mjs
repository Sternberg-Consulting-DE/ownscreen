import test from "node:test";
import assert from "node:assert/strict";
import { feedbackUrl, PROJECT_URL } from "../chrome-extension/feedback.js";

test("feedback opens the prefilled issue form of the public repository", () => {
  const url = new URL(feedbackUrl({ version: "1.4.0", browser: "Chrome 131" }));
  assert.equal(url.origin + url.pathname, `${PROJECT_URL}/issues/new`);
  assert.equal(url.searchParams.get("template"), "feedback.yml");
  assert.equal(url.searchParams.get("version"), "1.4.0");
  assert.equal(url.searchParams.get("browser"), "Chrome 131");
});

test("feedback omits unknown details", () => {
  const url = new URL(feedbackUrl());
  assert.equal(url.searchParams.has("version"), false);
  assert.equal(url.searchParams.has("browser"), false);
});
