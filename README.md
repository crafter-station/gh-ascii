# gh-ascii

Turn any GitHub handle into a neofetch-style ASCII profile card (SVG) for your
profile README — fully automatic. The avatar is converted to ASCII art and the
stats (uptime, languages, repos, stars, commits, followers, contact info) are
pulled live from the GitHub API.

Inspired by [Andrew6rant's profile README](https://github.com/Andrew6rant/Andrew6rant/tree/main),
but with zero manual setup: just a handle.

## Usage

No hosting required — the SVGs live in your own repo:

1. Open the generator UI at `/`, type your handle, and download
   `dark_mode.svg` + `light_mode.svg`.
2. Commit both files to your profile repo (`github.com/<you>/<you>`), next to
   the README.
3. Paste this into `README.md`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dark_mode.svg" />
  <source media="(prefers-color-scheme: light)" srcset="light_mode.svg" />
  <img alt="my GitHub profile" src="dark_mode.svg" />
</picture>
```

API (used by the UI, or embed directly if you host a deployment):

- `GET /<handle>` — returns the SVG card (`?theme=dark` default, `?theme=light`)
- `?cols=40..160` — ASCII resolution (default 100); higher = more detail, bigger card

## How the ASCII rendering works

Techniques borrowed from the best open-source converters (chafa, AAlib,
Acerola's ASCII shader, jp2a):

- **ML background removal** (ONNX portrait matting) isolates the subject.
- **Measured glyph metrics** — `scripts/calibrate-glyphs.html` renders every
  printable ASCII glyph in the card's actual font stack and measures its real
  ink coverage per cell quadrant (baked into `lib/glyphs.ts`). In Menlo, `N`
  is denser than `@` — hand-written ramps get this wrong.
- **AAlib-style structure matching** — each cell is sampled as 2x2 quadrants
  and matched against glyph quadrant coverage, so corners, stems and
  diagonals pick shape-appropriate glyphs.
- **Chafa-style fill/structure split** — flat cells walk a stable measured
  density ramp instead, so smooth areas don't turn into letter salad.
- **Acerola-style edge voting** — Sobel directions per subcell; a `/ \ | -`
  contour glyph overrides only when 3 of 4 subcells agree on direction.
- Adaptive unsharp, percentile normalization, damped Floyd–Steinberg on the
  density residual, and bimodal (line-art) detection round out the pipeline.

## Development

```bash
bun install
bun run dev
```

Optional: set `GITHUB_TOKEN` to raise the GitHub API rate limits (unauthenticated
is 60 requests/hour; commit counts come from the commit-search API and degrade
gracefully when rate-limited).

Responses are cached for an hour (`Cache-Control` + fetch revalidation), so
cards stay fresh without hammering the API.

## Credits

This project is inspired by
[**Andrew6rant/Andrew6rant**](https://github.com/Andrew6rant/Andrew6rant/tree/main) —
Andrew Grant's hand-crafted neofetch-style profile README (self-updating ASCII
portrait + live stats SVG) that set the visual bar. gh-ascii automates that
idea for any GitHub handle.

Rendering techniques were adapted from the open-source ASCII ecosystem:
[chafa](https://github.com/hpjansson/chafa) (fill/structure symbol split),
[AAlib](https://aa-project.sourceforge.net/aalib/) (subcell brightness matching),
[Acerola's ASCII shader](https://github.com/GarrettGunnell/AcerolaFX) (edge
direction voting), and [jp2a](https://github.com/Talinx/jp2a) (directional
edge glyphs).
# gh-ascii
