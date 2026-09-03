import type { NextRequest } from "next/server";
import { fetchStats, GitHubUserNotFound } from "@/lib/github";
import { imageToAscii, type Theme } from "@/lib/ascii";
import { MAX_IMAGE_BYTES, UnsafeImageSource } from "@/lib/image-source";
import { renderSvg } from "@/lib/svg";

const VALID_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

function parseCols(val: string | null): number {
  return Math.min(160, Math.max(40, Number(val) || 100));
}

function parseCutout(
  bgParam: string | null,
  cutoutParam: string | null
): boolean {
  if (bgParam === "keep" || bgParam === "original") return false;
  if (cutoutParam === "false" || cutoutParam === "0" || cutoutParam === "off") {
    return false;
  }
  return true;
}

// A custom image is fetched server-side, so a bad one is the caller's mistake
// (400), not ours (500). loadImage does the real vetting — private addresses,
// size, timeout, content type — this only shapes the response.
function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof GitHubUserNotFound) {
    return new Response(error.message, { status: 404 });
  }
  if (error instanceof UnsafeImageSource) {
    return new Response(error.message, { status: 400 });
  }
  console.error(error);
  return new Response(fallback, { status: 500 });
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

  try {
    const stats = await fetchStats(user);
    const ascii = await imageToAscii(
      customImage || stats.avatarUrl,
      theme,
      cols,
      { cutout }
    );
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
    return errorResponse(error, "Failed to generate card");
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
  // Checked before formData(), which would otherwise buffer the whole body
  // into memory before anything got a chance to reject it.
  if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    return new Response("Image file too large (max 10MB)", { status: 413 });
  }

  try {
    const formData = await request.formData();
    const theme: Theme = formData.get("theme") === "light" ? "light" : "dark";
    const cols = parseCols(formData.get("cols") as string | null);
    const cutout = parseCutout(
      formData.get("bg") as string | null,
      formData.get("cutout") as string | null
    );
    const file = formData.get("image");

    let imageInput: Blob | string | null = null;
    if (file instanceof Blob) {
      if (file.size > MAX_IMAGE_BYTES) {
        return new Response("Image file too large (max 10MB)", { status: 413 });
      }
      imageInput = file;
    } else if (typeof file === "string" && file.trim()) {
      // Same vetting as the GET query param — this field reaches the same
      // fetch, so it cannot be trusted any further.
      imageInput = file.trim();
    }

    const stats = await fetchStats(user);
    const ascii = await imageToAscii(
      imageInput || stats.avatarUrl,
      theme,
      cols,
      { cutout }
    );
    const svg = renderSvg(stats, ascii, theme);

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Failed to generate card from upload");
  }
}
