const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAccountsQuery,
  tagPayloadCandidates,
  mafileSessionHoursLeft,
  enrichMafileSession,
  classifyWorkerAccountStatus,
  isMafileSessionInvalid,
  serializeWorkerMafileSession,
} = require("../src/services/steamControlService");

test("buildAccountsQuery forwards UProject log filters with strict types", () => {
  assert.deepEqual(buildAccountsQuery({
    page: "2",
    limit: "500",
    search: "  steam-user  ",
    statuses: "MaFile,Invalid",
    mafile_only: "true",
    is_prime: "false",
    level_from: "5",
    inv_to: "300.50",
    games: "730,570",
  }), {
    page: 2,
    limit: 100,
    search: "steam-user",
    statuses: ["MaFile", "Invalid"],
    games: ["730", "570"],
    mafile_only: true,
    is_prime: false,
    level_from: 5,
    inv_to: 300.5,
  });
});

test("buildAccountsQuery drops empty and malformed optional filters", () => {
  assert.deepEqual(buildAccountsQuery({ page: "-4", unlocked: "maybe", inv_from: "nan" }), {
    page: 0,
    limit: 50,
  });
});

test("tagPayloadCandidates includes UProject fallback tag formats", () => {
  assert.deepEqual(tagPayloadCandidates("old", "Garbona: ожидает снятия"), [
    { customTag: "old", customTeamTag: "Garbona: ожидает снятия" },
    { custom_tag: "old", custom_team_tag: "Garbona: ожидает снятия" },
    { tag: "Garbona: ожидает снятия" },
    { customTag: "Garbona: ожидает снятия" },
    { customTeamTag: "Garbona: ожидает снятия" },
  ]);
});

test("mafileSessionHoursLeft treats past ISO as unlocked and future as waiting", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  assert.equal(mafileSessionHoursLeft("2026-08-23T16:50:52.916Z", now), 0);
  assert.equal(mafileSessionHoursLeft("2026-08-27T11:00:00.000Z", now), 47);
  assert.equal(mafileSessionHoursLeft("49", now), 49);
  assert.equal(mafileSessionHoursLeft("", now), 0);
});

test("enrichMafileSession labels unlocked and waiting MaFiles", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const [ready, waiting] = enrichMafileSession([
    { id: "1", status: "MaFile", mafileSessionAvailableAt: "2026-08-20T00:00:00.000Z" },
    { id: "2", status: "MaFile", mafileTime: "2026-08-27T12:00:00.000Z" },
  ], now);
  assert.equal(ready.mafileSessionUnlocked, true);
  assert.equal(ready.mafileSessionLabel, "анлок");
  assert.equal(waiting.mafileSessionUnlocked, false);
  assert.equal(waiting.mafileSessionLabel, "48 ч");
});

test("classifyWorkerAccountStatus does not hide Invalid behind isMaFile", () => {
  assert.equal(classifyWorkerAccountStatus({ status: "Invalid", isMaFile: true }), "Невалид");
  assert.equal(classifyWorkerAccountStatus({ status: "InvalidSession", isMaFile: true }), "Невалидная сессия");
  assert.equal(classifyWorkerAccountStatus({ status: "MaFile", isMaFile: true }), "MaFile");
  assert.equal(isMafileSessionInvalid({ status: "MaFile", isMaFile: true, invalidDate: "2026-08-26T11:40:00.000Z" }), true);
  assert.equal(isMafileSessionInvalid({ status: "MaFile", isMaFile: true, sessionValid: false }), true);
  assert.equal(isMafileSessionInvalid({ status: "MaFile", isMaFile: true }), false);
  const now = Date.parse("2026-08-26T15:00:00.000Z");
  const session = serializeWorkerMafileSession({
    status: "MaFile",
    isMaFile: true,
    mafileTime: "2026-08-28T12:00:00.000Z",
    invalidDate: "2026-08-26T11:40:00.000Z",
  }, now);
  assert.equal(session.eventType, "mafile");
  assert.equal(session.sessionInvalid, true);
  assert.equal(session.mafileSessionHoursLeft, 45);
});

test("classifyWorkerAccountStatus treats Ok + invalidDate as Invalid", () => {
  const { classifyWorkerAccountStatus, preferWorkerStatus, rawUprojectStatus } = require("../src/services/steamControlService");
  assert.equal(
    classifyWorkerAccountStatus({ status: "Ok", invalidDate: "2026-08-28T07:00:00.000Z" }),
    "Невалид"
  );
  assert.equal(rawUprojectStatus({ status: "Ok", invalidDate: "2026-08-28T07:00:00.000Z" }), "Invalid");
  assert.equal(preferWorkerStatus("Валид", "Невалид"), "Невалид");
  assert.equal(preferWorkerStatus("Невалид", "Валид"), "Невалид");
});

test("classifyWorkerAccountStatus prefers live UProject state over leftover MaFile", () => {
  assert.equal(classifyWorkerAccountStatus({ status: "OnSell", isMaFile: false }), "Продается");
  assert.equal(classifyWorkerAccountStatus({ status: "OnSell", isMaFile: true }), "Продается");
  assert.equal(classifyWorkerAccountStatus({ status: "Empty", isMaFile: true }), "Пустой");
  assert.equal(classifyWorkerAccountStatus({ status: "Empty", isMaFile: false }), "Пустой");
  assert.equal(classifyWorkerAccountStatus({ status: "Пустой", isMaFile: true }), "Пустой");
  assert.equal(classifyWorkerAccountStatus({ status: "Продается" }), "Продается");
  assert.equal(classifyWorkerAccountStatus({ status: "На продаже" }), "Продается");
  assert.equal(classifyWorkerAccountStatus({ status: "MaFile" }), "MaFile");
  const converted = serializeWorkerMafileSession({ status: "Empty", isMaFile: true });
  assert.equal(converted.eventType, "log");
  const stillMafile = serializeWorkerMafileSession({ status: "MaFile", isMaFile: true });
  assert.equal(stillMafile.eventType, "mafile");
});
