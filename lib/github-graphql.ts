// Everything the REST API can't give us cheaply: contribution counts, language
// distribution by bytes rather than repo count, and the 52-week contribution
// calendar. All of it needs a token — GraphQL has no anonymous tier — and all
// of it is optional: when the token is missing, the handle belongs to an
// organization (GraphQL has no `user` for those), or GitHub errors, the card
// falls back to the REST stats alone.

const GRAPHQL = "https://api.github.com/graphql";

// contributionsCollection accepts at most a one-year window, so a lifetime
// commit count means one aliased block per year. Nine aliases still cost a
// single rate-limit point, but twelve trip GitHub's per-query resource limit —
// hence the chunking. The year range comes from the account's createdAt, which
// the REST profile already gave us, so discovering it costs no extra round
// trip and every chunk goes out in parallel with the main query.
const YEARS_PER_QUERY = 8;

export interface LanguageShare {
  name: string;
  /** Fraction of all code bytes, 0-1. */
  share: number;
}

export interface ContributionStats {
  /** Commit contributions summed over every year the account has existed. */
  commits: number;
  pullRequests: number;
  issues: number;
  /** Reviews are only available per-year; this is the last 12 months. */
  reviews: number;
  contributedTo: number;
  lastYear: number;
  privateContributions: number;
  /** Weekly contribution totals, oldest first, for the sparkline. */
  weeks: number[];
  forks: number;
  topRepo: { name: string; stars: number } | null;
  languages: LanguageShare[];
}

interface LanguageEdge {
  size: number;
  node: { name: string };
}

interface RepoNode {
  name: string;
  stargazerCount: number;
  forkCount: number;
  languages: { edges: LanguageEdge[] };
}

interface MainResponse {
  data?: {
    user: {
      repositoriesContributedTo: { totalCount: number };
      pullRequests: { totalCount: number };
      issues: { totalCount: number };
      contributionsCollection: {
        totalPullRequestReviewContributions: number;
        restrictedContributionsCount: number;
        contributionCalendar: {
          totalContributions: number;
          weeks: { contributionDays: { contributionCount: number }[] }[];
        };
      };
      repositories: { nodes: RepoNode[] };
    } | null;
  };
}

interface YearsResponse {
  data?: {
    user: Record<string, { totalCommitContributions: number }> | null;
  };
}

const MAIN_QUERY = `query($login:String!){
  user(login:$login){
    repositoriesContributedTo(contributionTypes:[COMMIT,PULL_REQUEST,REPOSITORY]){totalCount}
    pullRequests{totalCount}
    issues{totalCount}
    contributionsCollection{
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ contributionCount } }
      }
    }
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, orderBy:{field:STARGAZERS,direction:DESC}){
      nodes{
        name
        stargazerCount
        forkCount
        languages(first:8, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } }
      }
    }
  }
}`;

function yearsQuery(years: number[]): string {
  const blocks = years
    .map(
      (y) =>
        `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${y}-12-31T23:59:59Z"){ totalCommitContributions }`
    )
    .join(" ");
  return `query($login:String!){ user(login:$login){ ${blocks} } }`;
}

async function gql<T>(query: string, login: string): Promise<T | null> {
  try {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "gh-ascii",
      },
      body: JSON.stringify({ query, variables: { login } }),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function chunkYears(createdAt: string): number[][] {
  const first = new Date(createdAt).getFullYear();
  const last = new Date().getFullYear();
  if (!Number.isFinite(first) || last < first) return [];
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const chunks: number[][] = [];
  for (let i = 0; i < years.length; i += YEARS_PER_QUERY) {
    chunks.push(years.slice(i, i + YEARS_PER_QUERY));
  }
  return chunks;
}

export async function fetchContributions(
  login: string,
  createdAt: string
): Promise<ContributionStats | null> {
  if (!process.env.GITHUB_TOKEN) return null;

  const yearChunks = chunkYears(createdAt);
  const [main, ...yearResults] = await Promise.all([
    gql<MainResponse>(MAIN_QUERY, login),
    ...yearChunks.map((years) => gql<YearsResponse>(yearsQuery(years), login)),
  ]);

  // `user` is null for organizations, which the REST path still renders fine.
  const user = main?.data?.user;
  if (!user) return null;

  let commits = 0;
  for (const result of yearResults) {
    const blocks = result?.data?.user;
    if (!blocks) continue;
    for (const block of Object.values(blocks)) {
      commits += block.totalCommitContributions ?? 0;
    }
  }

  const repos = user.repositories.nodes;
  const bytes = new Map<string, number>();
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      bytes.set(edge.node.name, (bytes.get(edge.node.name) ?? 0) + edge.size);
    }
  }
  const totalBytes = [...bytes.values()].reduce((sum, n) => sum + n, 0);
  const languages: LanguageShare[] =
    totalBytes > 0
      ? [...bytes.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, size]) => ({ name, share: size / totalBytes }))
      : [];

  const calendar = user.contributionsCollection.contributionCalendar;
  const weeks = calendar.weeks.map((week) =>
    week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0)
  );

  const top = repos[0];

  return {
    commits,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    reviews:
      user.contributionsCollection.totalPullRequestReviewContributions,
    contributedTo: user.repositoriesContributedTo.totalCount,
    lastYear: calendar.totalContributions,
    privateContributions:
      user.contributionsCollection.restrictedContributionsCount,
    weeks,
    forks: repos.reduce((sum, r) => sum + r.forkCount, 0),
    topRepo: top ? { name: top.name, stars: top.stargazerCount } : null,
    languages,
  };
}
