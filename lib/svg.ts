import { accountUptime, type GitHubStats } from "./github";
import type { LanguageShare } from "./github-graphql";
import type { Theme } from "./ascii";

const FONT_SIZE = 16;
const LINE_HEIGHT = 20;
const CHAR_WIDTH = FONT_SIZE * 0.6;
// The ASCII art renders at a smaller size so it can carry ~2x the resolution
// in the same footprint. Cell aspect (6x12) matches CHAR_ASPECT in ascii.ts.
const ASCII_FONT_SIZE = 8;
const ASCII_CHAR_WIDTH = 4.8;
const ASCII_LINE_HEIGHT = 9.6;
const PAD = 28;
const GAP = 32;
const INFO_COLS = 58;

const PALETTES = {
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    ascii: "#c9d1d9",
    header: "#58a6ff",
    rule: "#3d444d",
    key: "#ffa657",
    dots: "#484f58",
    value: "#c9d1d9",
    number: "#79c0ff",
    spark: "#39d353",
  },
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    ascii: "#24292f",
    header: "#0969da",
    rule: "#d0d7de",
    key: "#953800",
    dots: "#8c959f",
    value: "#24292f",
    number: "#0550ae",
    spark: "#2da44e",
  },
} satisfies Record<Theme, Record<string, string>>;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Span {
  text: string;
  color: string;
}

type Line = Span[];

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

// "JavaScript 63%, TypeScript 25%, Swift 7%" — languages under 1% of the code
// are noise, and the list is trimmed entry by entry rather than mid-word.
function formatLanguages(
  languages: LanguageShare[],
  maxWidth: number
): string {
  const parts = languages
    .map((l) => ({ name: l.name, percent: Math.round(l.share * 100) }))
    .filter((l) => l.percent >= 1)
    .slice(0, 5)
    .map((l) => `${l.name} ${l.percent}%`);
  while (parts.length > 1 && parts.join(", ").length > maxWidth) parts.pop();
  return parts.join(", ");
}

const SPARK = " ▁▂▃▄▅▆▇█";

// A linear scale renders as a flat line with one spike for anyone who has had
// a busy week, so weeks are placed on a log scale. Zero stays blank, so gaps
// still read as gaps.
function sparkline(weeks: number[]): string {
  const recent = weeks.slice(-52);
  const max = Math.max(...recent, 1);
  return recent
    .map((count) => {
      if (count <= 0) return SPARK[0];
      const level = 1 + Math.floor((Math.log1p(count) / Math.log1p(max)) * 7);
      return SPARK[Math.max(1, Math.min(8, level))];
    })
    .join("");
}

function buildInfoLines(stats: GitHubStats, theme: Theme): Line[] {
  const c = PALETTES[theme];
  const lines: Line[] = [];

  const header = (text: string) => {
    const label = ` ${text} `;
    const fill = "─".repeat(Math.max(0, INFO_COLS - label.length - 1));
    lines.push([
      { text: "─", color: c.rule },
      { text: label, color: c.header },
      { text: fill, color: c.rule },
    ]);
  };

  const kv = (key: string, value: string, valueColor = c.value) => {
    const val = truncate(value, INFO_COLS - key.length - 8);
    const dotCount = Math.max(2, INFO_COLS - key.length - val.length - 6);
    lines.push([
      { text: `. ${key}: `, color: c.key },
      { text: ".".repeat(dotCount), color: c.dots },
      { text: ` ${val}`, color: valueColor },
    ]);
  };

  // Two stats on one line: "Repos: .... 95 | Stars: .... 342"
  const kv2 = (k1: string, v1: string, k2: string, v2: string) => {
    const half = Math.floor((INFO_COLS - 3) / 2);
    const part = (key: string, value: string): Line => {
      const dotCount = Math.max(2, half - key.length - value.length - 6);
      return [
        { text: `. ${key}: `, color: c.key },
        { text: ".".repeat(dotCount), color: c.dots },
        { text: ` ${value}`, color: c.number },
      ];
    };
    lines.push([
      ...part(k1, v1),
      { text: " | ", color: c.rule },
      ...part(k2, v2),
    ]);
  };

  const blank = () => lines.push([]);

  header(`${stats.login}@github`);
  kv("Uptime", accountUptime(stats.createdAt));
  if (stats.location) kv("Location", stats.location);
  if (stats.company) kv("Company", stats.company);
  // Byte shares when GraphQL gave them to us — ranking by repo count puts
  // OpenSCAD on Linus Torvalds' card.
  const contrib = stats.contributions;
  if (contrib && contrib.languages.length > 0) {
    kv("Languages", formatLanguages(contrib.languages, INFO_COLS - 17));
  } else if (stats.languages.length > 0) {
    kv("Languages", stats.languages.join(", "));
  }

  const contacts: Array<[string, string]> = [];
  if (stats.email) contacts.push(["Email", stats.email]);
  if (stats.blog) contacts.push(["Website", stats.blog]);
  if (stats.twitter) contacts.push(["Twitter", `@${stats.twitter}`]);
  contacts.push(["GitHub", `github.com/${stats.login}`]);

  blank();
  header("Contact");
  for (const [key, value] of contacts) kv(key, value);

  blank();
  header("GitHub Stats");
  const n = (value: number) => value.toLocaleString("en-US");
  kv2("Repos", n(stats.publicRepos), "Stars", n(stats.stars));
  if (contrib) {
    kv2("Forks", n(contrib.forks), "Followers", n(stats.followers));
    kv2("Commits", n(contrib.commits), "Contributed", n(contrib.contributedTo));
    kv2("PRs", n(contrib.pullRequests), "Issues", n(contrib.issues));
    if (contrib.topRepo) {
      kv("Top repo", `${contrib.topRepo.name} (${n(contrib.topRepo.stars)} ★)`);
    }

    blank();
    header("Last 12 Months");
    kv2(
      "Contributions",
      n(contrib.lastYear),
      "Reviews",
      n(contrib.reviews)
    );
    // The calendar total already includes private work, so this line is a
    // breakdown rather than an addition — worth a row only when it is a real
    // share of the year. "Private: 1" is noise.
    if (
      contrib.privateContributions > 0 &&
      contrib.privateContributions >= contrib.lastYear * 0.05
    ) {
      kv("Private", n(contrib.privateContributions), c.number);
    }
    lines.push([{ text: `  ${sparkline(contrib.weeks)}`, color: c.spark }]);
  } else {
    kv("Followers", n(stats.followers), c.number);
  }

  return lines;
}

export function renderSvg(
  stats: GitHubStats,
  asciiLines: string[],
  theme: Theme
): string {
  const c = PALETTES[theme];
  const infoLines = buildInfoLines(stats, theme);

  const asciiCols = Math.max(...asciiLines.map((l) => l.length), 1);
  const infoX = PAD + asciiCols * ASCII_CHAR_WIDTH + GAP;
  const width = Math.round(infoX + INFO_COLS * CHAR_WIDTH + PAD);

  const asciiHeight = asciiLines.length * ASCII_LINE_HEIGHT;
  const infoHeight = infoLines.length * LINE_HEIGHT;
  const contentHeight = Math.max(asciiHeight, infoHeight);
  const height = PAD * 2 + contentHeight;
  // Vertically center whichever column is shorter.
  const asciiTop = PAD + (contentHeight - asciiHeight) / 2;
  const infoTop = PAD + (contentHeight - infoHeight) / 2;

  const fontFamily = `font-family="'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace" xml:space="preserve"`;
  const asciiAttrs = `${fontFamily} font-size="${ASCII_FONT_SIZE}"`;
  const infoAttrs = `${fontFamily} font-size="${FONT_SIZE}"`;

  const asciiText = asciiLines
    .map((line, i) => {
      if (!line) return "";
      const y = asciiTop + (i + 1) * ASCII_LINE_HEIGHT - 3;
      return `<text x="${PAD}" y="${y}" fill="${c.ascii}" ${asciiAttrs}>${escapeXml(line)}</text>`;
    })
    .filter(Boolean)
    .join("\n  ");

  const infoText = infoLines
    .map((spans, i) => {
      if (spans.length === 0) return "";
      const y = infoTop + (i + 1) * LINE_HEIGHT - 5;
      const tspans = spans
        .map(
          (s) => `<tspan fill="${s.color}">${escapeXml(s.text)}</tspan>`
        )
        .join("");
      return `<text x="${infoX}" y="${y}" ${infoAttrs}>${tspans}</text>`;
    })
    .filter(Boolean)
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="ASCII GitHub profile card for ${escapeXml(stats.login)}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${c.bg}" stroke="${c.border}"/>
  ${asciiText}
  ${infoText}
</svg>`;
}
