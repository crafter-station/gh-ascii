/**
 * Generates brand assets from the gh-ascii design tokens:
 *   public/og.png            1200x630  Open Graph
 *   public/og-twitter.png    1200x600  Twitter card
 *   public/favicon.ico       16/32/48  multi-size ICO (PNG entries)
 *   app/favicon.ico          copy — the one Next.js actually serves
 *   app/opengraph-image.png  copy — auto-wired by the App Router
 *   app/twitter-image.png    copy — auto-wired by the App Router
 *
 * Run: bun scripts/generate-assets.ts   (idempotent)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");

// Tokens from app/globals.css — keep in sync by hand, they rarely change.
const BG = "#0d0d0d";
const FG = "#fafafa";
const MUTED = "#878787";
const BORDER = "#242424";
const DIM = "#4a4a4a";
const MONO = "'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace";

// Same fill alphabet the card renderer uses (lib/ascii.ts).
const RAMP = " .'`,:;~i!+*o=xjkXZO0MWNB&8%@";

// ASCII-shaded sphere — the brand mark: an avatar becoming ASCII.
function asciiOrb(cols: number, rows: number): string[] {
  const light = { x: -0.45, y: -0.55, z: 0.7 };
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      // Cells are ~2:1, so y counts double toward distance.
      const nx = (x - cols / 2 + 0.5) / (cols / 2);
      const ny = (y - rows / 2 + 0.5) / (rows / 2);
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) {
        line += " ";
        continue;
      }
      const nz = Math.sqrt(1 - d2);
      const lum = Math.max(
        0.05,
        nx * light.x + ny * light.y + nz * light.z
      );
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
    }
    lines.push(line);
  }
  return lines;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ogSvg(width: number, height: number): string {
  const orbCols = 44;
  const orbRows = 22;
  const orbFont = 17;
  const orbLine = 20;
  const orbWidth = orbCols * orbFont * 0.6;
  const orbX = width - 110 - orbWidth;
  const orbTop = (height - orbRows * orbLine) / 2;

  const orb = asciiOrb(orbCols, orbRows)
    .map((line, i) => {
      if (!line.trim()) return "";
      const y = orbTop + (i + 1) * orbLine;
      return `<text x="${orbX}" y="${y}" font-family=${JSON.stringify(
        MONO
      )} font-size="${orbFont}" fill="${DIM}" xml:space="preserve">${escapeXml(line)}</text>`;
    })
    .filter(Boolean)
    .join("\n  ");

  const midY = height / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${BG}"/>
  <rect x="32.5" y="32.5" width="${width - 65}" height="${height - 65}" fill="none" stroke="${BORDER}"/>
  ${orb}
  <text x="104" y="${midY - 24}" font-family=${JSON.stringify(MONO)} font-size="76" font-weight="600" fill="${FG}">gh-ascii</text>
  <text x="104" y="${midY + 36}" font-family=${JSON.stringify(MONO)} font-size="27" fill="${MUTED}">Your GitHub profile, as ASCII.</text>
  <text x="104" y="${height - 78}" font-family=${JSON.stringify(MONO)} font-size="18" fill="${DIM}" xml:space="preserve">$ avatar + live stats ─&gt; README card</text>
</svg>`;
}

function faviconSvg(size: number): string {
  // librsvg ignores dominant-baseline — center the glyph via a manual
  // baseline offset instead.
  const font = size * 0.82;
  const baseline = size * 0.5 + font * 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="50%" y="${baseline}" text-anchor="middle" font-family=${JSON.stringify(
    MONO
  )} font-size="${font}" fill="${FG}">@</text>
</svg>`;
}

// ICO container with PNG-encoded entries (valid in all modern browsers).
function packIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function renderPng(svg: string, width: number, height: number) {
  return sharp(Buffer.from(svg), { density: 96 })
    .resize(width, height)
    .png()
    .toBuffer();
}

const publicDir = join(ROOT, "public");
const appDir = join(ROOT, "app");
await mkdir(publicDir, { recursive: true });

const og = await renderPng(ogSvg(1200, 630), 1200, 630);
const ogTwitter = await renderPng(ogSvg(1200, 600), 1200, 600);
await writeFile(join(publicDir, "og.png"), og);
await writeFile(join(publicDir, "og-twitter.png"), ogTwitter);
// App Router file conventions — what Next.js actually serves as meta tags.
await writeFile(join(appDir, "opengraph-image.png"), og);
await writeFile(join(appDir, "twitter-image.png"), ogTwitter);

const icoSizes = [16, 32, 48];
const icoPngs = await Promise.all(
  icoSizes.map(async (size) => ({
    size,
    data: await renderPng(faviconSvg(size * 4), size, size),
  }))
);
const ico = packIco(icoPngs);
await writeFile(join(publicDir, "favicon.ico"), ico);
await writeFile(join(appDir, "favicon.ico"), ico);

console.log("generated:");
console.log("  public/og.png", og.length, "bytes");
console.log("  public/og-twitter.png", ogTwitter.length, "bytes");
console.log("  public/favicon.ico", ico.length, "bytes");
console.log("  app/{favicon.ico,opengraph-image.png,twitter-image.png}");
