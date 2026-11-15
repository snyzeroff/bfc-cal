/**
 * Registration widgets from external platforms.
 *
 * Board members paste either the embed code the platform gives them
 * (`<iframe src="…">`) or a link. We never store or render that HTML: we extract
 * the address, check it against an allow-list, and build our own sandboxed iframe.
 */

const LUMA_HOSTS = new Set(["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"]);

export type EmbedResult = { ok: true; url: string } | { ok: false; error: string };

export function parseEmbed(input: string): EmbedResult {
  const raw = input.trim();
  if (!raw) return { ok: true, url: "" };

  // Pasted embed code: take the src attribute only.
  const src = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
  if (/<\s*iframe/i.test(raw) && !src) return { ok: false, error: "This embed code has no address (src). Copy it again from Luma." };
  const candidate = (src ?? raw).replace(/&amp;/g, "&");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return { ok: false, error: "This is not a valid link or embed code." };
  }
  if (url.protocol !== "https:" || !LUMA_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: "Only Luma registration widgets (luma.com) can be embedded." };
  }

  // Accept the embed address, or an event page address that carries the event id.
  const id = /^\/(?:embed\/)?event\/(evt-[A-Za-z0-9]+)/.exec(url.pathname)?.[1];
  if (!id) {
    return { ok: false, error: "Paste the embed code from Luma (Event → Share → Embed), not the short event link." };
  }
  return { ok: true, url: `https://luma.com/embed/event/${id}/simple` };
}

/** Defence in depth for anything read back from storage before it reaches an iframe. */
export const isAllowedEmbed = (url: string) => /^https:\/\/luma\.com\/embed\/event\/evt-[A-Za-z0-9]+\/simple$/.test(url);
