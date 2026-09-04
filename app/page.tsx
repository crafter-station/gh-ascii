import { Suspense } from "react";
import { GithubStars } from "@/components/github-stars";
import { Generator } from "@/components/generator";

// Server-rendered so the copy exists without JavaScript. The generator reads
// ?u= through useSearchParams, which opts its whole subtree out of SSR — when
// it owned the page, crawlers that don't run JS received an empty body.
const FAQ = [
  {
    q: "How do I add ASCII art to my GitHub profile README?",
    a: "Enter your handle above and download dark_mode.svg and light_mode.svg. Commit both to your profile repo (github.com/<you>/<you>) next to the README, then reference them from a <picture> element so each theme loads the matching card.",
  },
  {
    q: "Does the card update automatically?",
    a: "A committed SVG is a snapshot, so stars, followers and uptime drift. The repo ships a drop-in GitHub Actions workflow that re-downloads both themes on a daily cron and commits only when the card actually changed.",
  },
  {
    q: "Do I need to host anything or add an API key?",
    a: "No. The SVGs live in your own repository as plain files, so your README makes no external requests, and the stats are read from the public GitHub API when the card is generated.",
  },
  {
    q: "Can I use my own image instead of my GitHub avatar?",
    a: "Yes. Point the card at any public image URL or upload a file, and turn the background cutout off if you want to keep the original background instead of isolating the subject.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

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
            Avatar or custom image and live stats rendered into a
            neofetch-style SVG card for your profile README.
          </p>
        </div>

        <Suspense>
          <Generator />
        </Suspense>

        <section className="mt-24 w-full max-w-3xl border-t pt-10">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Questions
          </h2>
          <dl className="mt-6 flex flex-col gap-7">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <dt className="text-sm font-medium">{q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {a}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-sm text-muted-foreground">
            Source, setup details and the refresh workflow live in the{" "}
            <a
              href="https://github.com/crafter-station/gh-ascii"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              gh-ascii repository
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between px-6">
          <span className="font-mono text-[10px] text-muted-foreground">
            avatar or custom image → ascii · stats via github api
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            dark &amp; light themes
          </span>
        </div>
      </footer>
    </div>
  );
}
