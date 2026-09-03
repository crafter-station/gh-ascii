"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { GithubStars } from "@/components/github-stars";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DETAIL_LEVELS = [80, 100, 120, 140] as const;
type AvatarMode = "github" | "url" | "upload";

// The server only fetches http(s), so anything else is worth catching before
// it costs a round trip.
function isFetchableUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

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
  const searchParams = useSearchParams();
  const initialHandle = searchParams.get("u");
  const initialImage = searchParams.get("image") || searchParams.get("img") || "";

  const [input, setInput] = useState(initialHandle ?? "");
  const [handle, setHandle] = useState<string | null>(initialHandle);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [cols, setCols] = useState<number>(100);
  const [bgCutout, setBgCutout] = useState<boolean>(true);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(
    initialImage ? "url" : "github"
  );
  const [imageUrl, setImageUrl] = useState<string>(initialImage);
  const [appliedImageUrl, setAppliedImageUrl] = useState<string>(
    isFetchableUrl(initialImage) ? initialImage : ""
  );
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [uploadedSvgUrl, setUploadedSvgUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin
  );

  const colsQuery = cols !== 100 ? `&cols=${cols}` : "";
  const cutoutQuery = !bgCutout ? "&bg=keep" : "";
  const imageQuery =
    avatarMode === "url" && appliedImageUrl
      ? `&image=${encodeURIComponent(appliedImageUrl)}`
      : "";

  const cardPath =
    handle && avatarMode !== "upload"
      ? `/${handle}?theme=${theme}${colsQuery}${imageQuery}${cutoutQuery}`
      : null;

  // A half-typed URL is not a request worth making: the card only picks up a
  // value once it parses and the typing has settled.
  useEffect(() => {
    const candidate = imageUrl.trim();
    const timer = setTimeout(() => {
      setAppliedImageUrl(isFetchableUrl(candidate) ? candidate : "");
    }, 500);
    return () => clearTimeout(timer);
  }, [imageUrl]);

  // Each object URL is revoked when it is replaced or the page unmounts —
  // sharing one effect revoked the still-displayed preview whenever the
  // rendered card changed.
  useEffect(() => {
    if (!uploadedPreview) return;
    return () => URL.revokeObjectURL(uploadedPreview);
  }, [uploadedPreview]);

  useEffect(() => {
    if (!uploadedSvgUrl) return;
    return () => URL.revokeObjectURL(uploadedSvgUrl);
  }, [uploadedSvgUrl]);

  // Handle uploaded file generation via POST
  useEffect(() => {
    if (avatarMode !== "upload" || !uploadedFile || !handle) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadUploadedCard() {
      setUploadPending(true);
      try {
        const formData = new FormData();
        formData.append("image", uploadedFile!);
        formData.append("theme", theme);
        formData.append("cols", String(cols));
        formData.append("bg", bgCutout ? "remove" : "keep");

        const res = await fetch(`/${handle}`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to generate card: ${res.status}`);
        }

        const blob = await res.blob();
        if (!isMounted) return;

        setUploadedSvgUrl(URL.createObjectURL(blob));
      } catch (err: unknown) {
        if (
          !isMounted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : "Failed to render card with uploaded image."
        );
      } finally {
        if (isMounted) setUploadPending(false);
      }
    }

    loadUploadedCard();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [avatarMode, uploadedFile, handle, theme, cols, bgCutout]);

  const activeCardSrc = avatarMode === "upload" ? uploadedSvgUrl : cardPath;
  // Scoped to upload mode so an in-flight POST abandoned by a mode switch
  // can't leave the overlay up over a card that has already loaded.
  const loading =
    Boolean(handle) &&
    ((avatarMode === "upload" && uploadPending) ||
      (activeCardSrc !== null && activeCardSrc !== loadedSrc));

  const snippet = `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dark_mode.svg" />
  <source media="(prefers-color-scheme: light)" srcset="light_mode.svg" />
  <img alt="${handle ?? "my"}'s GitHub profile" src="dark_mode.svg" />
</picture>`;

  const aiPrompt = `Add a gh-ascii ASCII profile card to my GitHub profile README.

Context:
- My GitHub handle: ${handle}
- My profile README lives in the repo ${handle}/${handle}. If it doesn't exist, create it as a public repo with a README.
- Card generator: ${origin}/${handle}?theme=dark|light${imageQuery}${cutoutQuery} returns an SVG.

Steps:
1. Clone github.com/${handle}/${handle} and download both themes into its root:
   curl -fL "${origin}/${handle}?theme=dark${colsQuery}${imageQuery}${cutoutQuery}" -o dark_mode.svg
   curl -fL "${origin}/${handle}?theme=light${colsQuery}${imageQuery}${cutoutQuery}" -o light_mode.svg
2. Render or open both SVGs and look at them before committing.
3. Insert this at the top of README.md, keeping all existing content:
   <picture>
     <source media="(prefers-color-scheme: dark)" srcset="dark_mode.svg" />
     <source media="(prefers-color-scheme: light)" srcset="light_mode.svg" />
     <img alt="${handle}'s GitHub profile" src="dark_mode.svg" />
   </picture>
   If the light card reads poorly against white, use a plain <img src="dark_mode.svg" width="100%" /> instead of <picture> — the dark card carries its own background.
4. Commit both SVGs + the README change ("feat: add gh-ascii profile card") and push.
5. Confirm it renders at github.com/${handle}.`;

  function generate(e: React.FormEvent) {
    e.preventDefault();
    const clean = input.trim().replace(/^@/, "");
    if (!clean) return;
    setError(null);
    setHandle(clean);

    const params = new URLSearchParams();
    params.set("u", clean);
    if (avatarMode === "url" && imageUrl.trim()) {
      params.set("image", imageUrl.trim());
    }
    window.history.replaceState(null, "", `/?${params.toString()}`);
  }

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file (PNG, JPEG, WebP, GIF).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image file is too large (maximum 10MB).");
      return;
    }
    setError(null);
    setUploadedFile(file);
    setUploadedPreview(URL.createObjectURL(file));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  function refresh<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      if (handle) setError(null);
    };
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function downloadSvg(downloadTheme: "dark" | "light") {
    if (!handle) return;
    setDownloading(downloadTheme);
    try {
      if (avatarMode === "upload" && uploadedFile) {
        const formData = new FormData();
        formData.append("image", uploadedFile);
        formData.append("theme", downloadTheme);
        formData.append("cols", String(cols));
        formData.append("bg", bgCutout ? "remove" : "keep");

        const res = await fetch(`/${handle}`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${downloadTheme}_mode.svg`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const res = await fetch(
          `/${handle}?theme=${downloadTheme}${colsQuery}${imageQuery}${cutoutQuery}`
        );
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${downloadTheme}_mode.svg`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setError(`Failed to download ${downloadTheme}_mode.svg`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <span className="font-mono text-sm">gh-ascii</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/Andrew6rant/Andrew6rant"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              inspiration ↗
            </a>
            <GithubStars />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-16">
        <div className="w-full max-w-xl text-center">
          <h1 className="text-2xl font-medium tracking-tight">
            Your GitHub profile, as ASCII.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Avatar or custom image and live stats rendered into a neofetch-style SVG card.
          </p>
        </div>

        <form onSubmit={generate} className="mt-8 flex w-full max-w-xl flex-col gap-4">
          <div className="flex w-full">
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
          </div>

          {/* Custom Avatar Mode Selector */}
          <div className="border bg-card/40 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Avatar Source
                </span>
                <Segmented
                  value={avatarMode}
                  options={["github", "url", "upload"] as const}
                  onChange={(mode) => {
                    setAvatarMode(mode);
                    if (handle) setError(null);
                  }}
                  format={(m) =>
                    m === "github"
                      ? "GitHub Avatar"
                      : m === "url"
                      ? "Image URL"
                      : "Upload File"
                  }
                />
              </div>

              {avatarMode === "url" && (
                <div className="mt-1 flex items-center gap-3">
                  <Input
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                      if (handle) setError(null);
                    }}
                    placeholder="https://example.com/photo.png (direct image URL)"
                    spellCheck={false}
                    className="h-9 font-mono text-xs"
                  />
                  {imageUrl.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setImageUrl("")}
                      className="h-9 px-2 font-mono text-xs"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}

              {avatarMode === "upload" && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "mt-1 flex cursor-pointer flex-col items-center justify-center border border-dashed p-5 transition-colors",
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50 hover:bg-card"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                  />
                  {uploadedPreview ? (
                    <div className="flex items-center gap-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={uploadedPreview}
                        alt="Uploaded preview"
                        className="h-12 w-12 border object-cover"
                      />
                      <div className="text-left font-mono text-xs">
                        <p className="font-medium truncate max-w-[240px]">
                          {uploadedFile?.name}
                        </p>
                        <p className="text-muted-foreground text-[10px]">
                          {uploadedFile
                            ? `${(uploadedFile.size / 1024).toFixed(1)} KB`
                            : ""} · Click to replace
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center font-mono text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">
                        Drop image here or click to browse
                      </p>
                      <p className="mt-1 text-[10px]">
                        PNG, JPG, WebP, GIF up to 10MB
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
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
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Background
            </span>
            <Segmented
              value={bgCutout ? "cutout" : "original"}
              options={["cutout", "original"] as const}
              onChange={(val) => {
                setBgCutout(val === "cutout");
                if (handle) setError(null);
              }}
              format={(v) => (v === "cutout" ? "Auto Cutout" : "Keep BG")}
            />
          </div>
        </div>

        {error && (
          <p className="mt-8 font-mono text-sm text-red-500">{error}</p>
        )}

        {handle && !error && activeCardSrc && (
          <section className="mt-10 flex w-full flex-col items-center gap-6">
            <div className="relative w-full border border-dashed p-4">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                  <span className="font-mono text-xs text-muted-foreground">
                    rendering @{handle}…
                  </span>
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={activeCardSrc}
                src={activeCardSrc}
                alt={`ASCII profile card for ${handle}`}
                className={cn("mx-auto w-full max-w-4xl", loading && "opacity-40")}
                ref={(el) => {
                  if (el?.complete && el.naturalWidth > 0) {
                    setLoadedSrc(activeCardSrc);
                  }
                }}
                onLoad={() => setLoadedSrc(activeCardSrc)}
                onError={() => {
                  setLoadedSrc(activeCardSrc);
                  if (avatarMode === "upload") return;
                  if (imageQuery) {
                    setError("That image URL could not be rendered.");
                    return;
                  }
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
                      onClick={() => copy("snippet", snippet)}
                      className="font-mono"
                    >
                      {copied === "snippet" ? "copied" : "copy"}
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

                {avatarMode !== "upload" && (
                  <div className="bg-card/50 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          Agent mode — skip the steps
                        </p>
                        <p className="mt-1 text-sm">
                          Paste this prompt into Claude Code, Cursor, or any
                          coding agent and it does all of the above for you.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => copy("prompt", aiPrompt)}
                        className="shrink-0 font-mono"
                      >
                        {copied === "prompt" ? "copied" : "copy prompt"}
                      </Button>
                    </div>
                    <pre className="mt-3 max-h-48 overflow-auto border bg-card p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {aiPrompt}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {cardPath && (
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
            )}
          </section>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between px-6">
          <span className="font-mono text-[10px] text-muted-foreground">
            avatar or custom image → ascii · stats via github api
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
