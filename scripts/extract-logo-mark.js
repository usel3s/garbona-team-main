const fs = require("fs");
const path = require("path");
const { loadImage, createCanvas } = require("@napi-rs/canvas");

const svgPath = path.join(__dirname, "../panel/assets/logo-mark.svg");
const outPng = path.join(__dirname, "../panel/assets/logo-mark.canvas.png");

async function main() {
  const svg = fs.readFileSync(svgPath, "utf8");
  const match = svg.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error("PNG payload not found in logo-mark.svg");
  const pngBuffer = Buffer.from(match[1], "base64");
  fs.writeFileSync(outPng, pngBuffer);
  console.log("extracted png bytes:", pngBuffer.length);

  const img = await loadImage(pngBuffer);
  const canvas = createCanvas(200, 140);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eef3f8";
  ctx.fillRect(0, 0, 200, 140);
  ctx.drawImage(img, 10, 10, 180, 120);
  const preview = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(__dirname, "../assets/brand/logo-mark-preview-test.png"), preview);
  console.log("preview bytes:", preview.length, "img", img.width, img.height);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
