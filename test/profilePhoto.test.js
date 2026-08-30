const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveWorkerPhotoUrl } = require("../src/utils/profilePhoto");

test("team lists keep numeric Telegram avatars behind the local proxy", () => {
  assert.equal(
    resolveWorkerPhotoUrl({
      telegramId: "123456",
      username: "garbona_user",
      avatarUrl: "https://example.com/avatar.jpg",
    }),
    "/assets/avatar/123456"
  );
});

test("current user may prefer the stored Telegram Login avatar", () => {
  assert.equal(
    resolveWorkerPhotoUrl(
      {
        telegramId: "123456",
        username: "garbona_user",
        avatarUrl: "https://example.com/avatar.jpg",
      },
      { preferStored: true }
    ),
    "https://example.com/avatar.jpg"
  );
});

test("non-Telegram panel accounts fall back to a public username photo", () => {
  assert.equal(
    resolveWorkerPhotoUrl({
      telegramId: "padmin:owner",
      username: "garbona_owner",
    }),
    "https://t.me/i/userpic/320/garbona_owner.jpg"
  );
});
