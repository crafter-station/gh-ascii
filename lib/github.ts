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

async function fetchRepos(login: string): Promise<RepoSummary[]> {
  const res = await fetch(
    `${API}/users/${login}/repos?per_page=100&sort=pushed`,
    { headers: ghHeaders(), next: { revalidate: 3600 } }
  );
  if (!res.ok) return [];
  return res.json();
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

  const [repos, commits] = await Promise.all([
    fetchRepos(login),
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
    publicRepos: user.public_repos,
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
