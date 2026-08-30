const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("worker login exposes credentials, consent, Telegram and clean links", () => {
  const html = fs.readFileSync(path.join(__dirname, "../panel/worker/login.html"), "utf8");
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /recovery-код/);
  assert.match(html, /id="consentInput"/);
  assert.match(html, /id="tgAuthBtn"/);
  assert.match(html, /href="\/docs\/#manuals-project-rules"/);
  assert.doesNotMatch(html, /href="[^"]+\.html/);
  assert.match(html, /src="js\/login\.js"/);
  assert.doesNotMatch(html, /<script>\s*\(async function/);
});

test("worker navigation no longer sends users to html document URLs", () => {
  const files = ["auth.js", "discord.js", "shell.js"];
  const source = files
    .map((file) => fs.readFileSync(path.join(__dirname, "../panel/worker/js", file), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /(?:login|discord|index)\.html/);
  assert.match(source, /\/app\/login/);
});
