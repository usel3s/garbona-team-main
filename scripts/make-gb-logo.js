const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const srcPath =
  process.argv[2] || path.join(__dirname, "../assets/brand/bot-avatar.png");

const darkPngOutputs = [
  path.join(__dirname, "../assets/brand/gb-icon.png"),
  path.join(__dirname, "../panel/assets/logo.png"),
  path.join(__dirname, "../panel/worker/assets/logo.png"),
  path.join(__dirname, "../landing/assets/logo.png"),
  path.join(__dirname, "../docs-site/logo.png"),
];
const markPngOutputs = [
  path.join(__dirname, "../assets/brand/gb-mark.png"),
  path.join(__dirname, "../panel/assets/logo-mark.png"),
  path.join(__dirname, "../panel/worker/assets/logo-mark.png"),
];
const darkSvgOutputs = [
  path.join(__dirname, "../assets/brand/gb-icon.svg"),
  path.join(__dirname, "../panel/assets/logo.svg"),
  path.join(__dirname, "../panel/worker/assets/logo.svg"),
  path.join(__dirname, "../landing/assets/logo.svg"),
];
const markSvgOutputs = [
  path.join(__dirname, "../assets/brand/gb-mark.svg"),
  path.join(__dirname, "../panel/assets/logo-mark.svg"),
];

function isColoredPixel(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return Math.max(r, g, b) > 100 && Math.max(r, g, b) - Math.min(r, g, b) > 18;
}

function findLogoBounds(data, width, height) {
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (isColoredPixel(data, pixel * 4)) mask[pixel] = 1;
  }

  let best = null;
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1) continue;

    mask[start] = 2;
    stack.push(start);
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [];
      if (x > 0) neighbors.push(pixel - 1);
      if (x + 1 < width) neighbors.push(pixel + 1);
      if (y > 0) neighbors.push(pixel - width);
      if (y + 1 < height) neighbors.push(pixel + width);
      for (const next of neighbors) {
        if (mask[next] !== 1) continue;
        mask[next] = 2;
        stack.push(next);
      }
    }

    if (!best || count > best.count) {
      best = { count, minX, minY, maxX, maxY };
    }
  }

  if (!best) throw new Error("GB artwork was not found in the source image");
  const edge = Math.max(3, Math.round(Math.max(width, height) * 0.004));
  return {
    x: Math.max(0, best.minX - edge),
    y: Math.max(0, best.minY - edge),
    width: Math.min(width - 1, best.maxX + edge) - Math.max(0, best.minX - edge) + 1,
    height: Math.min(height - 1, best.maxY + edge) - Math.max(0, best.minY - edge) + 1,
  };
}

function smoothstep(min, max, value) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

function removeWhiteBackground(imageData) {
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const alpha = smoothstep(3, 24, chroma);

    if (alpha <= 0) {
      pixels[i + 3] = 0;
      continue;
    }

    if (alpha < 1) {
      pixels[i] = Math.max(0, Math.min(255, (r - 255 * (1 - alpha)) / alpha));
      pixels[i + 1] = Math.max(0, Math.min(255, (g - 255 * (1 - alpha)) / alpha));
      pixels[i + 2] = Math.max(0, Math.min(255, (b - 255 * (1 - alpha)) / alpha));
    }
    pixels[i + 3] = Math.round(alpha * 255);
  }
  return imageData;
}

function writePngAndSvg(png, pngPaths, svgPaths, viewBox = "0 0 512 512") {
  const encoded = png.toString("base64");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    `<image width="100%" height="100%" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${encoded}"/>`,
    "</svg>",
    "",
  ].join("");

  for (const file of pngPaths) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
  }
  for (const file of svgPaths) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, svg);
  }
}

function buildDarkIcon(glyph, bounds) {
  const size = 512;
  const out = createCanvas(size, size);
  const ctx = out.getContext("2d");
  const background = ctx.createLinearGradient(48, 24, 464, 488);
  background.addColorStop(0, "#151c1a");
  background.addColorStop(1, "#090d0c");
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(8, 8, size - 16, size - 16, 112);
  ctx.fill();
  ctx.strokeStyle = "rgba(121, 233, 176, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const scale = Math.min((size * 0.84) / bounds.width, (size * 0.7) / bounds.height);
  const dw = bounds.width * scale;
  const dh = bounds.height * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  ctx.shadowColor = "rgba(55, 206, 184, 0.28)";
  ctx.shadowBlur = 18;
  ctx.drawImage(glyph, dx, dy, dw, dh);
  return out.toBuffer("image/png");
}

function buildTransparentMark(glyph, bounds) {
  // Tight transparent canvas — only GB letters (no black squircle), for light cards.
  const maxSide = 512;
  const scale = Math.min(maxSide / bounds.width, maxSide / bounds.height);
  const pad = Math.round(8 * scale);
  const dw = Math.round(bounds.width * scale);
  const dh = Math.round(bounds.height * scale);
  const out = createCanvas(dw + pad * 2, dh + pad * 2);
  const ctx = out.getContext("2d");
  ctx.drawImage(glyph, pad, pad, dw, dh);
  return out.toBuffer("image/png");
}

(async () => {
  const img = await loadImage(srcPath);
  const source = createCanvas(img.width, img.height);
  const sourceContext = source.getContext("2d");
  sourceContext.drawImage(img, 0, 0);
  const sourceData = sourceContext.getImageData(0, 0, img.width, img.height);
  const bounds = findLogoBounds(sourceData.data, img.width, img.height);

  const glyph = createCanvas(bounds.width, bounds.height);
  const glyphContext = glyph.getContext("2d");
  glyphContext.drawImage(
    img,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  const glyphData = glyphContext.getImageData(0, 0, bounds.width, bounds.height);
  glyphContext.putImageData(removeWhiteBackground(glyphData), 0, 0);

  const darkPng = buildDarkIcon(glyph, bounds);
  const markPng = buildTransparentMark(glyph, bounds);
  writePngAndSvg(darkPng, darkPngOutputs, darkSvgOutputs, "0 0 512 512");
  // Mark viewBox matches letter aspect (~635:418)
  writePngAndSvg(markPng, markPngOutputs, markSvgOutputs, "0 0 635 418");

  console.log(
    `source ${img.width}x${img.height}; crop ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`
  );
  console.log(`dark icon ${darkPng.length} bytes → ${darkPngOutputs.length} files`);
  console.log(`transparent mark ${markPng.length} bytes → ${markPngOutputs.length} files`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
