import { fetchContributions, type ContributionStats } from "./github-graphql";

const API = "https://api.github.com";

export interface GitHubStats {
  login: string;
  name: string;
  avatarUrl: string;
  createdAt: string;
  location: string | null;
  company: string | null;
  blog: string | null;
  email: string | null;
  twitter: string | null;
  followers: number;
  publicRepos: number;
  stars: number;
  languages: string[];
  /** Present only on tokened deployments, and never for organizations. */
  contributions: ContributionStats | null;
}

export class GitHubUserNotFound extends Error {
  constructor(login: string) {
    super(`GitHub user "${login}" not found`);
  }
}

// GitHub profile fields arrive with stray whitespace often enough to skew the
// card's dot leaders ("India " renders a column short).
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasToken(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function ghHeaders(accept = "application/vnd.github+json"): HeadersInit {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "gh-ascii",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

interface RepoSummary {
  fork: boolean;
  stargazers_count: number;
  language: string | null;
}

const REPO_PAGE_SIZE = 100; // GitHub's per_page maximum
// Bounds the fan-out so a handle with thousands of repos can't turn one card
// render into an unbounded request storm. Past the cap the least recently
// pushed tail is dropped (the list is sorted by `pushed`), which is the
// cheapest thing to be wrong about.
//
// The unauthenticated budget is 60 requests/hour for the whole deployment's
// IP, so one 15-page render there would spend a quarter of it on a single
// card. Tokened deployments get 5,000/hour and can afford the accuracy.
const MAX_REPO_PAGES_AUTHED = 15;
const MAX_REPO_PAGES_ANON = 3;

async function fetchRepoPage(
  login: string,
  page: number
): Promise<RepoSummary[]> {
  const res = await fetch(
    `${API}/users/${login}/repos?per_page=${REPO_PAGE_SIZE}&page=${page}&sort=pushed`,
    { headers: ghHeaders(), next: { revalidate: 3600 } }
  );
  if (!res.ok) return [];
  const batch = await res.json();
  return Array.isArray(batch) ? batch : [];
}

// One page only covers the 100 most recently pushed repos, which understates
// stars and skews languages for anyone past that. `public_repos` gives us the
// page count up front, so every page goes out in parallel instead of walking
// `Link` headers a round trip at a time. A page that fails (rate limit) costs
// us its repos rather than the whole card.
async function fetchRepos(
  login: string,
  publicRepos: number
): Promise<RepoSummary[]> {
  const pages = Math.min(
    hasToken() ? MAX_REPO_PAGES_AUTHED : MAX_REPO_PAGES_ANON,
    Math.max(1, Math.ceil(publicRepos / REPO_PAGE_SIZE))
  );
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchRepoPage(login, i + 1))
  );
  return batches.flat();
}

export async function fetchStats(login: string): Promise<GitHubStats> {
  const userRes = await fetch(`${API}/users/${login}`, {
    headers: ghHeaders(),
    next: { revalidate: 3600 },
  });
  if (userRes.status === 404) throw new GitHubUserNotFound(login);
  if (!userRes.ok) {
    throw new Error(`GitHub API error: ${userRes.status} ${await userRes.text()}`);
  }
  const user = await userRes.json();

  const publicRepos: number =
    typeof user.public_repos === "number" ? user.public_repos : 0;

  const [repos, contributions] = await Promise.all([
    fetchRepos(login, publicRepos),
    fetchContributions(login, user.created_at),
  ]);

  const stars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

  const langCounts = new Map<string, number>();
  for (const repo of repos) {
    if (repo.fork || !repo.language) continue;
    langCounts.set(repo.language, (langCounts.get(repo.language) ?? 0) + 1);
  }
  const languages = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang]) => lang);

  return {
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
    location: text(user.location),
    company: text(user.company),
    blog: text(user.blog),
    email: text(user.email),
    twitter: text(user.twitter_username),
    followers: user.followers,
    publicRepos,
    stars,
    languages,
    contributions,
  };
}

export function accountUptime(createdAt: string, now = new Date()): string {
  const created = new Date(createdAt);
  let years = now.getFullYear() - created.getFullYear();
  let months = now.getMonth() - created.getMonth();
  let days = now.getDate() - created.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  parts.push(`${days} day${days === 1 ? "" : "s"}`);
  return parts.join(", ");
}
