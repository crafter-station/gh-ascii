import { Jimp, intToRGBA } from "jimp";
import { GLYPHS, type Glyph } from "./glyphs";

export type Theme = "dark" | "light";

// Glyph selection is AAlib-style structure matching: each cell is sampled as
// a 2x2 quadrant grid and matched against the measured quadrant ink coverage
// of every glyph in the actual output font (lib/glyphs.ts). Structured cells
// pick the glyph whose ink *distribution* matches (corners, stems,
// diagonals). Flat cells instead walk a fixed density ramp — free matching
// there lets same-density letterforms (g/u/a…) alternate on quadrant noise
// and smooth areas turn into letter salad. This mirrors chafa's split:
// Hamming-matched "structured" symbols vs popcount-ordered "fill" symbols.
const FLAT_CELL_SPREAD = 0.25;

const glyphMean = (g: Glyph) => (g.q[0] + g.q[1] + g.q[2] + g.q[3]) / 4;
const glyphSpread = (g: Glyph) => Math.max(...g.q) - Math.min(...g.q);

// Fill cells only draw from the classic "blobby" ASCII-art alphabet —
// letterforms at the same density read as text, not texture. Ramp order and
// spacing come from the measured coverage, not the ramp string.
const FILL_ALPHABET = " .'`,:;~i!+*o=xjkXZO0MWNB&8%@$#";

// One glyph per density level, preferring the most quadrant-symmetric
// candidate near each target density.
const FILL_RAMP: Glyph[] = (() => {
  const candidates = GLYPHS.filter((g) => FILL_ALPHABET.includes(g.ch));
  const levels = 24;
  const ramp: Glyph[] = [];
  for (let i = 0; i < levels; i++) {
    const target = i / (levels - 1);
    let best = candidates[0];
    let bestScore = Infinity;
    for (const g of candidates) {
      const score = Math.abs(glyphMean(g) - target) + 0.5 * glyphSpread(g);
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (ramp[ramp.length - 1] !== best) ramp.push(best);
  }
  return ramp;
})();

// Damped Floyd–Steinberg on the per-cell density residual; full strength
// makes glyph output shimmer.
const DITHER_STRENGTH = 0.25;

// With the background removed there is nothing to suppress — lift midtones
// slightly so facial detail survives quantization.
const GAMMA = 0.9;

// Monospace glyphs are roughly twice as tall as they are wide.
const CHAR_ASPECT = 0.5;

// Images whose subject has almost no midtones (logos, line art, cel-shaded
// avatars) render crisper as near-binary output: no dithering and contrast
// pushed to the extremes.
const BIMODAL_MID_FRACTION = 0.22;

interface Cell {
  brightness: number; // 0..1, theme-oriented (1 = dense glyph)
  background: boolean;
}

async function fetchAvatar(avatarUrl: string): Promise<Blob> {
  // Ask for a larger source than the sampling grid so the resize averages
  // real detail instead of upscaling a thumbnail.
  const url = avatarUrl.includes("?")
    ? `${avatarUrl}&s=400`
    : `${avatarUrl}?s=400`;
  const res = await fetch(url, {
    headers: { "User-Agent": "gh-ascii" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`Failed to fetch avatar: ${res.status}`);
  return res.blob();
}

// ML background removal (ONNX portrait matting). Heuristic flood fills leak
// through soft hair edges on real photos; the model gives a clean alpha
// matte. Imported lazily: the package loads native modules (sharp,
// onnxruntime) at import time, which must not run while the build collects
// page data — and if the host can't load them, the card still renders with
// its background instead of failing.
async function cutoutSubject(avatar: Blob): Promise<Blob> {
  try {
    const { removeBackground } = await import(
      "@imgly/background-removal-node"
    );
    return await removeBackground(avatar, {
      output: { format: "image/png" },
    });
  } catch (error) {
    console.error("background removal failed, using original avatar", error);
    return avatar;
  }
}

// Samples at subcell resolution: 2x2 samples per character cell, feeding the
// quadrant matcher.
async function sampleImage(
  avatar: Blob,
  theme: Theme,
  cols: number
): Promise<Cell[][]> {
  const image = await Jimp.read(Buffer.from(await avatar.arrayBuffer()));
  const rows = Math.max(
    1,
    Math.round((cols * image.height * CHAR_ASPECT) / image.width)
  );
  const subW = cols * 2;
  const subH = rows * 2;
  image.resize({ w: subW, h: subH });

  const grid: Cell[][] = [];
  for (let y = 0; y < subH; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < subW; x++) {
      const { r, g, b, a } = intToRGBA(image.getPixelColor(x, y));
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const oriented = theme === "dark" ? luma : 1 - luma;
      row.push({
        // Soft matte edges fade out instead of aliasing.
        brightness: oriented * (a / 255),
        background: a < 64,
      });
    }
    grid.push(row);
  }
  return grid;
}

// Unsharp mask over the subcell grid: cells that averaged fine detail into
// flat gray get pushed away from their neighborhood mean, recovering local
// contrast (sunglasses, eyes, fabric texture). The amount adapts to how
// textured the subject is — detailed illustrations get sharpened hard, while
// smooth photo skin would only pick up speckle, so it's left mostly alone.
// Only non-background neighbors participate so the silhouette doesn't grow a
// bright halo.
function unsharp(grid: Cell[][]) {
  const rows = grid.length;
  const cols = grid[0].length;
  const source = grid.map((row) => row.map((c) => c.brightness));

  const deviations: number[][] = [];
  let devSum = 0;
  let devCount = 0;
  for (let y = 0; y < rows; y++) {
    const devRow: number[] = [];
    for (let x = 0; x < cols; x++) {
      if (grid[y][x].background) {
        devRow.push(0);
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
          if (grid[ny][nx].background) continue;
          sum += source[ny][nx];
          count++;
        }
      }
      const dev = source[y][x] - sum / count;
      devRow.push(dev);
      devSum += Math.abs(dev);
      devCount++;
    }
    deviations.push(devRow);
  }
  if (devCount === 0) return;

  const texture = devSum / devCount;
  const amount = Math.min(0.9, Math.max(0, (texture - 0.03) * 15));
  if (amount === 0) return;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x].background) continue;
      grid[y][x].brightness = Math.min(
        1,
        Math.max(0, source[y][x] + amount * deviations[y][x])
      );
    }
  }
}

// Stretch the subject's 2nd–98th brightness percentile across the full 0..1
// range so low-contrast avatars still use the whole glyph range.
function normalize(grid: Cell[][]) {
  const values = grid
    .flat()
    .filter((c) => !c.background)
    .map((c) => c.brightness)
    .sort((a, b) => a - b);
  if (values.length === 0) return;
  const lo = values[Math.floor(values.length * 0.02)];
  const hi = values[Math.min(values.length - 1, Math.floor(values.length * 0.98))];
  const range = Math.max(hi - lo, 0.01);
  for (const row of grid) {
    for (const cell of row) {
      const stretched = Math.min(1, Math.max(0, (cell.brightness - lo) / range));
      cell.brightness = Math.pow(stretched, GAMMA);
    }
  }
}

function isBimodal(grid: Cell[][]): boolean {
  const subject = grid.flat().filter((c) => !c.background);
  if (subject.length === 0) return false;
  const mid = subject.filter(
    (c) => c.brightness > 0.25 && c.brightness < 0.75
  ).length;
  return mid / subject.length < BIMODAL_MID_FRACTION;
}

// Gentle S-curve: pushes already-polarized tones to the extremes so
// anti-aliasing halos don't render as speckle between flat fills.
function sCurve(v: number): number {
  return v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v);
}

// Edge overlay (Acerola-style): Sobel directions computed per subcell, then
// each cell votes — a directional glyph only overrides the tone/structure
// glyph when at least 3 of the 4 subcells agree it sits on a strong edge.
// Per-sample edges are salt-and-pepper; voted edges trace clean contours.
const EDGE_THRESHOLD = 1.2;
const EDGE_VOTES_NEEDED = 3;
const EDGE_CHARS = ["|", "\\", "-", "/"] as const;

function subcellEdges(grid: Cell[][]): (number | null)[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const at = (x: number, y: number) => {
    const cell =
      grid[Math.min(rows - 1, Math.max(0, y))][
        Math.min(cols - 1, Math.max(0, x))
      ];
    return cell.background ? 0 : cell.brightness;
  };

  return grid.map((row, y) =>
    row.map((_, x) => {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      // Subcells are twice as tall as wide, so vertical differences span
      // twice the distance — halve gy to compare in the same units.
      const gy =
        (-at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
          at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) / 2;
      if (Math.hypot(gx, gy) < EDGE_THRESHOLD) return null;
      // Gradient angle folded to [0, 180); the edge runs perpendicular.
      const deg = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      if (deg < 22.5 || deg >= 157.5) return 0; // |
      if (deg < 67.5) return 1; // \
      if (deg < 112.5) return 2; // -
      return 3; // /
    })
  );
}

function voteEdge(dirs: (number | null)[]): string | null {
  const counts = [0, 0, 0, 0];
  for (const d of dirs) {
    if (d !== null) counts[d]++;
  }
  const winner = counts.indexOf(Math.max(...counts));
  // The same direction must dominate the cell — mixed-direction texture
  // (plaid, hatching) stays tonal instead of turning into scratches.
  if (counts[winner] < EDGE_VOTES_NEEDED) return null;
  return EDGE_CHARS[winner];
}

function matchGlyph(q: number[], candidates: Glyph[]): Glyph {
  let best = candidates[0];
  let bestError = Infinity;
  for (const glyph of candidates) {
    const d0 = q[0] - glyph.q[0];
    const d1 = q[1] - glyph.q[1];
    const d2 = q[2] - glyph.q[2];
    const d3 = q[3] - glyph.q[3];
    const error = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
    if (error < bestError) {
      bestError = error;
      best = glyph;
    }
  }
  return best;
}

// Drop blank rows and the common left margin the cutout leaves behind.
function trim(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  const trimmed = lines.slice(start, end);
  if (trimmed.length === 0) return lines;
  const indent = Math.min(
    ...trimmed
      .filter((l) => l.trim() !== "")
      .map((l) => l.length - l.trimStart().length)
  );
  return trimmed.map((l) => l.slice(indent));
}

// Cards are cached at the HTTP layer, but within one server instance avoid
// re-running matting + sampling for the same avatar.
const cache = new Map<string, Promise<string[]>>();
const CACHE_LIMIT = 100;

export function avatarToAscii(
  avatarUrl: string,
  theme: Theme,
  cols = 100
): Promise<string[]> {
  const key = `${avatarUrl}|${theme}|${cols}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    const avatar = await fetchAvatar(avatarUrl);
    const cutout = await cutoutSubject(avatar);
    const sub = await sampleImage(cutout, theme, cols);
    unsharp(sub);
    normalize(sub);
    const bimodal = isBimodal(sub);
    if (bimodal) {
      for (const row of sub) {
        for (const cell of row) cell.brightness = sCurve(cell.brightness);
      }
    }
    const dither = bimodal ? 0 : DITHER_STRENGTH;
    const edges = subcellEdges(sub);

    const rows = sub.length / 2;
    // Per-cell density residual carried by Floyd–Steinberg.
    const carry: number[][] = Array.from({ length: rows }, () =>
      new Array(cols).fill(0)
    );

    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        const quads = [
          sub[y * 2][x * 2],
          sub[y * 2][x * 2 + 1],
          sub[y * 2 + 1][x * 2],
          sub[y * 2 + 1][x * 2 + 1],
        ];
        if (quads.every((c) => c.background)) {
          line += " ";
          continue;
        }
        const q = quads.map((c) =>
          c.background
            ? 0
            : Math.min(1, Math.max(0, c.brightness + carry[y][x]))
        );
        const edgeChar = voteEdge([
          edges[y * 2][x * 2],
          edges[y * 2][x * 2 + 1],
          edges[y * 2 + 1][x * 2],
          edges[y * 2 + 1][x * 2 + 1],
        ]);
        const spread = Math.max(...q) - Math.min(...q);
        const qMeanRaw = (q[0] + q[1] + q[2] + q[3]) / 4;
        const glyph =
          spread < FLAT_CELL_SPREAD
            ? FILL_RAMP[
                Math.min(
                  FILL_RAMP.length - 1,
                  Math.round(qMeanRaw * (FILL_RAMP.length - 1))
                )
              ]
            : matchGlyph(q, GLYPHS);
        line += edgeChar ?? glyph.ch;

        const qMean = (q[0] + q[1] + q[2] + q[3]) / 4;
        const gMean =
          (glyph.q[0] + glyph.q[1] + glyph.q[2] + glyph.q[3]) / 4;
        const error = (qMean - gMean) * dither;
        if (error !== 0) {
          if (x + 1 < cols) carry[y][x + 1] += (error * 7) / 16;
          if (y + 1 < rows) {
            if (x > 0) carry[y + 1][x - 1] += (error * 3) / 16;
            carry[y + 1][x] += (error * 5) / 16;
            if (x + 1 < cols) carry[y + 1][x + 1] += (error * 1) / 16;
          }
        }
      }
      lines.push(line.trimEnd());
    }
    return trim(lines);
  })();

  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return pending;
}
