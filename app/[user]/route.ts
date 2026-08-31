import type { NextRequest } from "next/server";
import { fetchStats, GitHubUserNotFound } from "@/lib/github";
import { imageToAscii, type Theme } from "@/lib/ascii";
import { renderSvg } from "@/lib/svg";

const VALID_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

function parseCols(val: string | null): number {
  return Math.min(160, Math.max(40, Number(val) || 100));
}

function parseCutout(bgParam: string | null, cutoutParam: string | null): boolean {
  if (bgParam === "keep" || bgParam === "original") return false;
  if (cutoutParam === "false" || cutoutParam === "0" || cutoutParam === "off") return false;
  return true;
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/[user]">
) {
  const { user } = await ctx.params;
  const searchParams = request.nextUrl.searchParams;
  const theme: Theme = searchParams.get("theme") === "light" ? "light" : "dark";
  const cols = parseCols(searchParams.get("cols"));
  const customImage =
    searchParams.get("image") ||
    searchParams.get("avatar") ||
    searchParams.get("img");
  const cutout = parseCutout(
    searchParams.get("bg"),
    searchParams.get("cutout")
  );

  if (!VALID_LOGIN.test(user)) {
    return new Response("Invalid GitHub username", { status: 400 });
  }

  if (
    customImage &&
    !customImage.startsWith("http://") &&
    !customImage.startsWith("https://") &&
    !customImage.startsWith("data:image/")
  ) {
    return new Response("Invalid custom image URL", { status: 400 });
  }

  try {
    const stats = await fetchStats(user);
    const imageInput = customImage || stats.avatarUrl;
    const ascii = await imageToAscii(imageInput, theme, cols, { cutout });
    const svg = renderSvg(stats, ascii, theme);

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": customImage
          ? "public, max-age=1800, s-maxage=1800"
          : "public, max-age=3600, s-maxage=3600",
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

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/[user]">
) {
  const { user } = await ctx.params;

  if (!VALID_LOGIN.test(user)) {
    return new Response("Invalid GitHub username", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const theme: Theme = formData.get("theme") === "light" ? "light" : "dark";
    const cols = parseCols(formData.get("cols") as string | null);
    const bgParam = formData.get("bg") as string | null;
    const cutoutParam = formData.get("cutout") as string | null;
    const cutout = parseCutout(bgParam, cutoutParam);
    const file = formData.get("image");

    let imageInput: Blob | string | null = null;
    if (file instanceof Blob) {
      if (file.size > 10 * 1024 * 1024) {
        return new Response("Image file too large (max 10MB)", { status: 413 });
      }
      imageInput = file;
    } else if (typeof file === "string" && file.trim()) {
      imageInput = file.trim();
    }

    const stats = await fetchStats(user);
    const targetImage = imageInput || stats.avatarUrl;
    const ascii = await imageToAscii(targetImage, theme, cols, { cutout });
    const svg = renderSvg(stats, ascii, theme);

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof GitHubUserNotFound) {
      return new Response(error.message, { status: 404 });
    }
    console.error(error);
    return new Response("Failed to generate card from upload", { status: 500 });
  }
}

