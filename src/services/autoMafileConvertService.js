const SteamLog = require("../models/SteamLog");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { createSteamTask } = require("./steamApiService");

function unwrapPayload(payload, keys = []) {
  if (!payload || typeof payload !== "object") return payload;
  for (const key of keys) {
    if (payload[key] != null) return payload[key];
  }
  return payload;
}

function extractTaskId(payload) {
  const row = unwrapPayload(payload, ["data", "result", "task"]);
  if (row?.id != null) return String(row.id);
  if (Array.isArray(payload?.tasks) && payload.tasks[0]?.id != null) {
    return String(payload.tasks[0].id);
  }
  if (payload?.taskId != null) return String(payload.taskId);
  return "";
}

function mafileAutoConvertMaxUsd() {
  const max = Number(env.mafileAutoConvertMaxUsd ?? 15);
  return Number.isFinite(max) && max > 0 ? max : 15;
}

function shouldAutoConvertMafile(log, totalUsd) {
  const total = Number(totalUsd || 0);
  if (total >= mafileAutoConvertMaxUsd()) return false;
  if (!log || String(log.logKind || "") !== "mafile") return false;
  if (log.convertedFromMafile) return false;
  if (log.mafileSnapshot?.isFake) return false;
  if (String(log.mafileAutoConvertTaskId || "").trim()) return false;
  return true;
}

async function maybeAutoConvertMafileToLog(log) {
  const sourceId = String(log?.sourceId || "").trim();
  if (!/^\d+$/.test(sourceId)) return null;

  const claimed = await SteamLog.findOneAndUpdate(
    {
      _id: log._id,
      logKind: "mafile",
      convertedFromMafile: { $ne: true },
      $or: [{ mafileAutoConvertTaskId: { $exists: false } }, { mafileAutoConvertTaskId: "" }],
    },
    { $set: { mafileAutoConvertError: "" } },
    { new: true }
  );
  if (!claimed) return null;

  try {
    const taskResult = await createSteamTask({
      tasks: [{ task: "MaFileToLog" }],
      ids: [Number(sourceId)],
      name: "MaFile в лог",
    });
    const taskId = extractTaskId(taskResult);
    claimed.mafileAutoConvertTaskId = taskId || "queued";
    await claimed.save();
    logger.info("MaFile auto-convert queued", sourceId, claimed.mafileAutoConvertTaskId);
    return { started: true, taskId: claimed.mafileAutoConvertTaskId, log: claimed };
  } catch (error) {
    claimed.mafileAutoConvertTaskId = "";
    claimed.mafileAutoConvertError = String(error.message || error).slice(0, 500);
    await claimed.save();
    logger.warn("MaFile auto-convert failed", sourceId, claimed.mafileAutoConvertError);
    return { started: false, error: claimed.mafileAutoConvertError, log: claimed };
  }
}

module.exports = {
  mafileAutoConvertMaxUsd,
  shouldAutoConvertMafile,
  maybeAutoConvertMafileToLog,
};
