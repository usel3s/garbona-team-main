const fs = require("fs");
const { loadImage } = require("@napi-rs/canvas");
const logger = require("./logger");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);
const PNG_COLOR_TYPES = new Set([0, 2, 3, 4, 6]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Walks the PNG chunk list and verifies every CRC.
 *
 * Skia aborts the whole process with SIGSEGV instead of throwing when it is handed a
 * structurally broken PNG, so a corrupted asset would take the bot down rather than
 * degrade one image. Full CRC verification also catches files damaged in transit,
 * e.g. by a text-mode transfer that rewrites CR bytes inside binary data.
 */
function isIntactPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length + 12) return false;
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;

  let offset = PNG_SIGNATURE.length;
  let headerSeen = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) return false;

    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    if (crc32(buffer.subarray(offset + 4, dataEnd)) !== buffer.readUInt32BE(dataEnd)) return false;

    if (type === "IHDR") {
      if (headerSeen || length !== 13) return false;
      if (!buffer.readUInt32BE(offset + 8) || !buffer.readUInt32BE(offset + 12)) return false;
      if (!PNG_BIT_DEPTHS.has(buffer[offset + 16])) return false;
      if (!PNG_COLOR_TYPES.has(buffer[offset + 17])) return false;
      headerSeen = true;
    } else if (!headerSeen) {
      return false;
    }

    if (type === "IEND") return dataEnd + 4 === buffer.length;
    offset = dataEnd + 4;
  }

  return false;
}

function isSupportedImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return true;
  return isIntactPng(buffer);
}

/**
 * Decodes an image file from disk, returning null instead of throwing or crashing.
 */
async function loadLocalImage(filePath) {
  let buffer;
  try {
    buffer = await fs.promises.readFile(filePath);
  } catch (_) {
    return null;
  }

  if (!isSupportedImage(buffer)) {
    logger.warn("Image asset rejected as corrupted or unsupported", filePath);
    return null;
  }

  try {
    const image = await loadImage(buffer);
    return image?.width > 0 && image?.height > 0 ? image : null;
  } catch (error) {
    logger.warn("Image asset decode failed", filePath, error.message);
    return null;
  }
}

module.exports = { isIntactPng, isSupportedImage, loadLocalImage };
