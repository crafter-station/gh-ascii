import { lookup } from "node:dns/promises";

/** Cap on any image pulled into memory, whether uploaded or fetched. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 8_000;
const TOO_LARGE = `Image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`;
const MAX_REDIRECTS = 3;

export type ImageInput = string | Blob | Buffer | Uint8Array | ArrayBuffer;

/** Caller-facing rejection: the route turns these into a 400, not a 500. */
export class UnsafeImageSource extends Error {}

// `?image=` lets anyone aim the server's fetch at a host of their choosing, so
// the whole private space is refused. 169.254.169.254 is the address that
// actually hands out cloud credentials, but even a refused connection leaks
// internal topology through the timing difference against an unroutable one.
function isBlockedAddress(ip: string): boolean {
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  if (address.includes(".")) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // this host, private, loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && (b === 0 || b === 168)) return true; // protocol assignments, private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (/^f[cd]/.test(v6)) return true; // unique local
  if (/^fe[89ab]/.test(v6)) return true; // link-local
  return false;
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeImageSource("Malformed image URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeImageSource(`Unsupported image URL scheme "${url.protocol}"`);
  }
  return url;
}

// A hostname clears only if every address it resolves to is public — a public
// name pointed at a private IP is the usual way past a scheme check. The gap
// between this lookup and the fetch's own is a DNS-rebinding window we accept;
// closing it means dialing the resolved IP with a manual Host header.
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = url.hostname.startsWith("[") || /^[\d.]+$/.test(host);
  const addresses = literal
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);

  if (addresses.length === 0) {
    throw new UnsafeImageSource(`Cannot resolve image host "${host}"`);
  }
  if (addresses.some(isBlockedAddress)) {
    throw new UnsafeImageSource(`Refusing to fetch a private address ("${host}")`);
  }
}

async function readCapped(res: Response): Promise<Blob> {
  const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!type.startsWith("image/")) {
    throw new UnsafeImageSource(
      `Expected an image, got "${type || "no content-type"}"`
    );
  }
  if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    throw new UnsafeImageSource(TOO_LARGE);
  }

  // Content-Length is a hint, not a promise — count bytes as they land so a
  // chunked or lying response can't stream the function out of memory.
  const reader = res.body?.getReader();
  if (!reader) throw new UnsafeImageSource("Empty image response");

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new UnsafeImageSource(TOO_LARGE);
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type });
}

async function fetchRemote(raw: string): Promise<Blob> {
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = parseUrl(target);
    // Ask for a larger source than the sampling grid so the resize averages
    // real detail instead of upscaling a thumbnail.
    if (url.hostname.endsWith("githubusercontent.com") && !url.searchParams.has("s")) {
      url.searchParams.set("s", "400");
    }
    await assertPublicHost(url);

    const res = await fetch(url, {
      headers: { "User-Agent": "gh-ascii", Accept: "image/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new UnsafeImageSource("Redirect without a location");
      // Followed by hand so the next hop gets re-validated: redirecting into
      // 127.0.0.1 is the standard way around a host check done only once.
      target = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      throw new UnsafeImageSource(`Failed to fetch image: ${res.status}`);
    }
    return readCapped(res);
  }
  throw new UnsafeImageSource("Too many redirects");
}

const DATA_URI = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),([\s\S]*)$/i;

function decodeDataUri(raw: string): Blob {
  const match = DATA_URI.exec(raw);
  if (!match) throw new UnsafeImageSource("Malformed image data URI");

  const [, type, params, payload] = match;
  if (!/;\s*base64/i.test(params)) {
    throw new UnsafeImageSource("Only base64 image data URIs are supported");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new UnsafeImageSource(TOO_LARGE);
  }
  return new Blob([bytes as unknown as BlobPart], { type });
}

/**
 * Resolve any supported image input to a Blob. Every remote fetch passes the
 * private-address, size, timeout and content-type checks above, so callers
 * cannot hand an unvalidated URL through by accident.
 */
export async function loadImage(input: ImageInput): Promise<Blob> {
  if (typeof input === "string") {
    return input.startsWith("data:") ? decodeDataUri(input) : fetchRemote(input);
  }

  if (input instanceof Blob) {
    if (input.size > MAX_IMAGE_BYTES) {
      throw new UnsafeImageSource(TOO_LARGE);
    }
    return input;
  }

  if (
    Buffer.isBuffer(input) ||
    input instanceof Uint8Array ||
    input instanceof ArrayBuffer
  ) {
    if (input.byteLength > MAX_IMAGE_BYTES) {
      throw new UnsafeImageSource(TOO_LARGE);
    }
    return new Blob([input as unknown as BlobPart]);
  }

  throw new UnsafeImageSource("Unsupported image input format");
}
