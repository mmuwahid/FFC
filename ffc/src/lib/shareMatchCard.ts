// ffc/src/lib/shareMatchCard.ts
// V3.0:140 — Phase 3 WhatsApp Share PNG.
// Calls the render-match-card Edge Function, downloads the PNG, hands it
// to the device's native share sheet via Web Share API. Falls back to
// browser-download for surfaces without share-files support (desktop,
// older Android Chrome).
//
// S058 #25(a) — also exports getMatchCardUrl() for embedding the PNG as a
// hero in MatchDetailSheet. RPC is now open to any authenticated user
// (migration 0056).

import { supabase } from './supabase';

export type ShareResult =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'downloaded' }
  | { kind: 'error'; message: string };

/**
 * Session-scoped cache of signed URLs by match-id. URLs expire after 15min;
 * we let the browser surface the eventual 403 — the render path will refetch.
 */
const urlCache = new Map<string, { url: string; fetchedAt: number }>();
const URL_TTL_MS = 14 * 60 * 1000;  // 14 min, < EF's 15-min signed-URL expiry

/**
 * Returns a signed URL for the cached match-card PNG. Triggers a fresh render
 * on cache-miss inside the EF. Used by MatchDetailSheet to render a PNG hero
 * at the top of the sheet (S058 issue #25(a)).
 */
export async function getMatchCardUrl(matchId: string): Promise<string> {
  const cached = urlCache.get(matchId);
  if (cached && Date.now() - cached.fetchedAt < URL_TTL_MS) {
    return cached.url;
  }

  const { data, error } = await supabase.functions.invoke<{ signed_url: string }>(
    'render-match-card',
    { body: { match_id: matchId, force: false } },
  );
  if (error) throw new Error(error.message);
  if (!data?.signed_url) throw new Error('Empty response');

  urlCache.set(matchId, { url: data.signed_url, fetchedAt: Date.now() });
  return data.signed_url;
}

export async function shareMatchCard(
  matchId: string,
  opts: { force?: boolean } = {},
): Promise<ShareResult> {
  // 1. Call EF
  const { data, error } = await supabase.functions.invoke<{ signed_url: string }>(
    'render-match-card',
    { body: { match_id: matchId, force: opts.force ?? false } },
  );
  if (error) return { kind: 'error', message: error.message };
  if (!data?.signed_url) return { kind: 'error', message: 'Empty response' };

  // 2. Download blob
  const res = await fetch(data.signed_url);
  if (!res.ok) return { kind: 'error', message: `Failed to fetch card (${res.status})` };
  const blob = await res.blob();
  const filename = `ffc-match-${matchId.slice(0, 8)}.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  // 3. Web Share API path
  const shareData = {
    files: [file],
    title: 'FFC Match Result',
    text: 'Result is in 🏆',
  };
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return { kind: 'shared' };
    } catch (e) {
      // AbortError = user dismissed share sheet → not an error
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { kind: 'cancelled' };
      }
      // Other errors → fall through to download
    }
  }

  // 4. Download fallback
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { kind: 'downloaded' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Download failed' };
  }
}
