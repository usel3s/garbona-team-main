/**
 * Парсит длительность: 1d/1д, 30m/30м, 2h/2ч, 1w/1н, 60s/60с
 * @returns {{ seconds: number, untilDate: number } | null}
 */
function parseDuration(str) {
  if (!str || typeof str !== "string") return null;
  const match = str.trim().match(/^(\d+)\s*([smhdwсмчдн])$/i);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  if (num <= 0) return null;

  const unit = match[2].toLowerCase();
  const map = {
    s: 1,
    с: 1,
    m: 60,
    м: 60,
    h: 60 * 60,
    ч: 60 * 60,
    d: 24 * 60 * 60,
    д: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
    н: 7 * 24 * 60 * 60,
  };
  const mult = map[unit];
  if (!mult) return null;

  const seconds = num * mult;
  return { seconds, untilDate: Math.floor(Date.now() / 1000) + seconds };
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} сек.`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин.`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч.`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} д.`;
  return `${Math.floor(seconds / 604800)} нед.`;
}

module.exports = { parseDuration, formatDuration };
