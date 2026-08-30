const fs = require("fs");
const path = require("path");
const { loadImage, createCanvas } = require("@napi-rs/canvas");

const srcPath = path.join(__dirname, "../panel/assets/logo-mark.svg");
const outPath = path.join(__dirname, "../panel/assets/logo-mark.raster.png");

async function main() {
  const svg = fs.readFileSync(srcPath, "utf8");
  const match = svg.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error("PNG payload not found in logo-mark.svg");
  const source = await loadImage(Buffer.from(match[1], "base64"));
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, source.width, source.height);
  ctx.drawImage(source, 0, 0);
  const png = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, png);
  console.log("saved", outPath, png.length, "bytes", source.width, source.height);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
