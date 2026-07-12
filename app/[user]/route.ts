import type { NextRequest } from "next/server";
import { fetchStats, GitHubUserNotFound } from "@/lib/github";
import { avatarToAscii, type Theme } from "@/lib/ascii";
import { renderSvg } from "@/lib/svg";

const VALID_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/[user]">
) {
  const { user } = await ctx.params;
  const searchParams = request.nextUrl.searchParams;
  const theme: Theme = searchParams.get("theme") === "light" ? "light" : "dark";
  const cols = Math.min(
    160,
    Math.max(40, Number(searchParams.get("cols")) || 100)
  );

  if (!VALID_LOGIN.test(user)) {
    return new Response("Invalid GitHub username", { status: 400 });
  }

  try {
    const stats = await fetchStats(user);
    const ascii = await avatarToAscii(stats.avatarUrl, theme, cols);
    const svg = renderSvg(stats, ascii, theme);

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    if (error instanceof GitHubUserNotFound) {
      return new Response(error.message, { status: 404 });
    }
    console.error(error);
    return new Response("Failed to generate card", { status: 500 });
  }
}
