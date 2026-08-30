require("dotenv").config();

const t = String(process.env.BOT_TOKEN || "").trim();
const parts = t.split(":");

console.log("token_set", Boolean(t));
console.log("token_len", t.length);
console.log("id_part_len", (parts[0] || "").length);
console.log("id_digits", /^\d+$/.test(parts[0] || ""));
console.log("secret_len", (parts[1] || "").length);
console.log("has_spaces", /\s/.test(t));
console.log("has_quotes", /^["']|["']$/.test(t));

fetch(`https://api.telegram.org/bot${t}/getMe`)
  .then((r) => r.json())
  .then((j) => {
    if (j.ok) {
      console.log("getMe_ok", `@${j.result.username}`, `id=${j.result.id}`);
    } else {
      console.log("getMe_fail", j.error_code, j.description);
    }
  })
  .catch((e) => {
    console.error("fetch_err", e.message);
    process.exitCode = 1;
  });
