"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DETAIL_LEVELS = [80, 100, 120, 140] as const;

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  format,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
}) {
  return (
    <div className="flex border divide-x">
      {options.map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "h-8 px-3 font-mono text-xs transition-colors",
            option === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          {format ? format(option) : String(option)}
        </button>
      ))}
    </div>
  );
}

function Generator() {
  // ?u=<handle> makes generated cards shareable/linkable.
  const searchParams = useSearchParams();
  const initialHandle = searchParams.get("u");

  const [input, setInput] = useState(initialHandle ?? "");
  const [handle, setHandle] = useState<string | null>(initialHandle);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [cols, setCols] = useState<number>(100);
  const [loading, setLoading] = useState(Boolean(initialHandle));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const colsQuery = cols !== 100 ? `&cols=${cols}` : "";
  const cardPath = handle ? `/${handle}?theme=${theme}${colsQuery}` : null;
  // The SVGs get committed to the user's profile repo, so the README
  // references them as plain files — no hosting, no external requests.
  const snippet = `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dark_mode.svg" />
  <source media="(prefers-color-scheme: light)" srcset="light_mode.svg" />
  <img alt="${handle ?? "my"}'s GitHub profile" src="dark_mode.svg" />
</picture>`;

  function generate(e: React.FormEvent) {
    e.preventDefault();
    const clean = input.trim().replace(/^@/, "");
    if (!clean) return;
    setError(null);
    setLoading(true);
    setHandle(clean);
    window.history.replaceState(null, "", `/?u=${encodeURIComponent(clean)}`);
  }

  function refresh<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      if (handle) {
        setError(null);
        setLoading(true);
      }
    };
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadSvg(downloadTheme: "dark" | "light") {
    if (!handle) return;
    setDownloading(downloadTheme);
    try {
      const res = await fetch(`/${handle}?theme=${downloadTheme}${colsQuery}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${downloadTheme}_mode.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <span className="font-mono text-sm">gh-ascii</span>
          <a
            href="https://github.com/Andrew6rant/Andrew6rant"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            inspiration ↗
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-16">
        <div className="w-full max-w-xl text-center">
          <h1 className="text-2xl font-medium tracking-tight">
            Your GitHub profile, as ASCII.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Avatar and live stats rendered into a neofetch-style SVG card.
            Fully automatic — just a handle.
          </p>
        </div>

        <form onSubmit={generate} className="mt-8 flex w-full max-w-xl">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
              @
            </span>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="github handle"
              spellCheck={false}
              autoFocus
              className="h-11 border-r-0 pl-8 font-mono"
            />
          </div>
          <Button type="submit" size="lg" disabled={loading} className="h-11">
            {loading ? "Generating…" : "Generate"}
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Theme
            </span>
            <Segmented
              value={theme}
              options={["dark", "light"] as const}
              onChange={refresh(setTheme)}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Detail
            </span>
            <Segmented
              value={cols}
              options={DETAIL_LEVELS}
              onChange={refresh(setCols)}
            />
          </div>
        </div>

        {error && (
          <p className="mt-8 font-mono text-sm text-red-500">{error}</p>
        )}

        {cardPath && !error && (
          <section className="mt-10 flex w-full flex-col items-center gap-6">
            <div className="relative w-full border border-dashed p-4">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                  <span className="font-mono text-xs text-muted-foreground">
                    fetching @{handle}…
                  </span>
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={cardPath}
                src={cardPath}
                alt={`ASCII profile card for ${handle}`}
                className={cn("mx-auto w-full max-w-4xl", loading && "opacity-40")}
                ref={(el) => {
                  // With ?u= deep links the SSR'd image can finish loading
                  // before hydration attaches onLoad — check on mount.
                  if (el?.complete && el.naturalWidth > 0) setLoading(false);
                }}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setHandle(null);
                  setError(`No card for "${handle}" — does that user exist?`);
                }}
              />
            </div>

            {!loading && (
              <div className="w-full max-w-3xl border divide-y">
                <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Step 1
                    </p>
                    <p className="mt-1 text-sm">
                      Download both themes — no hosting needed, the files live
                      in your repo.
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-3">
                    <Button
                      onClick={() => downloadSvg("dark")}
                      disabled={downloading !== null}
                      className="font-mono text-xs"
                    >
                      {downloading === "dark" ? "…" : "dark_mode.svg"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadSvg("light")}
                      disabled={downloading !== null}
                      className="font-mono text-xs"
                    >
                      {downloading === "light" ? "…" : "light_mode.svg"}
                    </Button>
                  </div>
                </div>

                <div className="p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Step 2
                  </p>
                  <p className="mt-1 text-sm">
                    Commit them to your profile repo —{" "}
                    <a
                      href={`https://github.com/${handle}/${handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs underline underline-offset-4 hover:text-muted-foreground"
                    >
                      github.com/{handle}/{handle}
                    </a>{" "}
                    — next to your README.
                  </p>
                </div>

                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Step 3 — paste into README.md
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copySnippet}
                      className="font-mono"
                    >
                      {copied ? "copied" : "copy"}
                    </Button>
                  </div>
                  <pre className="mt-3 overflow-x-auto border bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                    {snippet}
                  </pre>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    The &lt;picture&gt; tag switches between dark and light
                    automatically with the viewer&apos;s GitHub theme.
                  </p>
                </div>
              </div>
            )}

            <a
              href={cardPath}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "font-mono text-xs text-muted-foreground"
              )}
            >
              Open raw SVG ↗
            </a>
          </section>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between px-6">
          <span className="font-mono text-[10px] text-muted-foreground">
            avatar → ascii · stats via github api
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            dark & light themes
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <Generator />
    </Suspense>
  );
}
