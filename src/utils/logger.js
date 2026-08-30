const util = require("util");

const MAX_BUFFER_LINES = 500;
const DEFAULT_EXPORT_LINES = 250;

/** @type {string[]} */
const logBuffer = [];

function formatArg(value) {
  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }
  if (typeof value === "string") return value;
  try {
    return util.inspect(value, { depth: 3, breakLength: 120, colors: false });
  } catch (_) {
    return String(value);
  }
}

function pushLine(level, args) {
  const line = `[${level}] ${new Date().toISOString()} ${args.map(formatArg).join(" ")}`;
  logBuffer.push(line);
  while (logBuffer.length > MAX_BUFFER_LINES) {
    logBuffer.shift();
  }
  return line;
}

const logger = {
  info: (...args) => {
    pushLine("INFO", args);
    console.log("[INFO]", new Date().toISOString(), ...args);
  },
  warn: (...args) => {
    pushLine("WARN", args);
    console.warn("[WARN]", new Date().toISOString(), ...args);
  },
  error: (...args) => {
    pushLine("ERROR", args);
    console.error("[ERROR]", new Date().toISOString(), ...args);
  },
};

/**
 * Последние N строк буфера логов бота (в памяти текущего процесса).
 */
function getRecentLogLines(limit = DEFAULT_EXPORT_LINES) {
  const n = Math.max(1, Math.min(MAX_BUFFER_LINES, Number(limit) || DEFAULT_EXPORT_LINES));
  return logBuffer.slice(-n);
}

function getRecentLogsText(limit = DEFAULT_EXPORT_LINES) {
  const lines = getRecentLogLines(limit);
  if (!lines.length) {
    return `[INFO] ${new Date().toISOString()} Лог-буфер пуст (процесс только что запущен или ещё нет записей).`;
  }
  return lines.join("\n");
}

module.exports = {
  logger,
  getRecentLogLines,
  getRecentLogsText,
  DEFAULT_EXPORT_LINES,
  MAX_BUFFER_LINES,
};
