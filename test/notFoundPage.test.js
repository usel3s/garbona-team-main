const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("404 page does not depend on worker /app assets", () => {
  const html = fs.readFileSync(path.join(__dirname, "../panel/worker/404.html"), "utf8");
  assert.doesNotMatch(html, /<base\s/i);
  assert.doesNotMatch(html, /href="css\//);
  assert.doesNotMatch(html, /src="js\//);
  assert.match(html, /Страница не найдена/);
  assert.match(html, /href="\/"/);
  assert.match(html, /src="\/shared\/not-found\.js"/);
  assert.ok(fs.existsSync(path.join(__dirname, "../panel/shared/not-found.js")));
});
