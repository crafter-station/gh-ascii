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
  commits: number | null;
}

export class GitHubUserNotFound extends Error {
  constructor(login: string) {
    super(`GitHub user "${login}" not found`);
  }
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
// render into an unbounded request storm. Covers accounts up to 1,500 repos;
// past that the least recently pushed tail is dropped (the list is sorted by
// `pushed`), which is the cheapest thing to be wrong about.
const MAX_REPO_PAGES = 15;

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
    MAX_REPO_PAGES,
    Math.max(1, Math.ceil(publicRepos / REPO_PAGE_SIZE))
  );
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchRepoPage(login, i + 1))
  );
  return batches.flat();
}

// The commit search endpoint has a separate (small) rate limit, so treat it
// as best-effort decoration rather than required data.
async function fetchCommitCount(login: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${API}/search/commits?q=author:${login}&per_page=1`,
      { headers: ghHeaders(), next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.total_count === "number" ? data.total_count : null;
  } catch {
    return null;
  }
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

  const [repos, commits] = await Promise.all([
    fetchRepos(login, publicRepos),
    fetchCommitCount(login),
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
    location: user.location || null,
    company: user.company || null,
    blog: user.blog || null,
    email: user.email || null,
    twitter: user.twitter_username || null,
    followers: user.followers,
    publicRepos,
    stars,
    languages,
    commits,
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
