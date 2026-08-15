/**
 * Spotify adapter.
 *
 * Uses the Authorization Code refresh-token flow with a server-held refresh
 * token; the token never reaches the browser. Playback control needs Spotify
 * Premium — the API returns 403 `PREMIUM_REQUIRED` for free accounts, and that
 * limitation is reported to the UI honestly rather than hidden.
 */

import type {
  PlaybackResult,
  SpotifyPlaylist,
  SpotifyResult,
  SpotifyTrack,
} from "@/lib/integrations/contracts";

import { serverEnv } from "../env";

export type { PlaybackResult, SpotifyPlaylist, SpotifyResult, SpotifyTrack };

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

export function spotifyConfigured(): boolean {
  return Boolean(
    serverEnv.spotifyClientId && serverEnv.spotifyClientSecret && serverEnv.spotifyRefreshToken,
  );
}

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) return tokenCache.accessToken;
  if (!spotifyConfigured()) throw new Error("Spotify credentials are not configured");

  const basic = btoa(`${serverEnv.spotifyClientId}:${serverEnv.spotifyClientSecret}`);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: serverEnv.spotifyRefreshToken!,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 400
        ? "Spotify refresh token is invalid or was revoked — reconnect in Integrations"
        : `Spotify token endpoint returned ${response.status}`,
    );
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Spotify did not return an access token");
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return tokenCache.accessToken;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
}

function toTrack(item: Record<string, unknown>, isPlaying: boolean): SpotifyTrack {
  const artists = (item["artists"] as Array<{ name?: string }> | undefined) ?? [];
  const album = item["album"] as { name?: string; images?: Array<{ url?: string }> } | undefined;
  const external = item["external_urls"] as { spotify?: string } | undefined;
  return {
    title: String(item["name"] ?? "Unknown track"),
    artist:
      artists
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ") || "Unknown artist",
    album: album?.name,
    url: external?.spotify,
    imageUrl: album?.images?.[album.images.length - 1]?.url,
    isPlaying,
    durationMs: typeof item["duration_ms"] === "number" ? item["duration_ms"] : undefined,
  };
}

export async function fetchSpotify(): Promise<SpotifyResult> {
  if (!spotifyConfigured()) {
    return {
      configured: false,
      ok: false,
      recent: [],
      playlists: [],
      error: "Spotify credentials are not set",
    };
  }

  try {
    const [playerRes, recentRes, playlistRes, meRes] = await Promise.all([
      api("/me/player/currently-playing"),
      api("/me/player/recently-played?limit=5"),
      api("/me/playlists?limit=20"),
      api("/me"),
    ]);

    let nowPlaying: SpotifyTrack | undefined;
    if (playerRes.status === 200) {
      const data = (await playerRes.json()) as {
        item?: Record<string, unknown>;
        is_playing?: boolean;
        progress_ms?: number;
        device?: { name?: string };
      };
      if (data.item) {
        nowPlaying = {
          ...toTrack(data.item, Boolean(data.is_playing)),
          progressMs: data.progress_ms,
          device: data.device?.name,
        };
      }
    }

    const recent: SpotifyTrack[] = [];
    if (recentRes.ok) {
      const data = (await recentRes.json()) as {
        items?: Array<{ track?: Record<string, unknown> }>;
      };
      for (const entry of data.items ?? []) {
        if (entry.track) recent.push(toTrack(entry.track, false));
      }
    }

    const playlists: SpotifyPlaylist[] = [];
    if (playlistRes.ok) {
      const data = (await playlistRes.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      for (const p of data.items ?? []) {
        const tracks = p["tracks"] as { total?: number } | undefined;
        const external = p["external_urls"] as { spotify?: string } | undefined;
        playlists.push({
          id: String(p["id"] ?? ""),
          name: String(p["name"] ?? "Playlist"),
          trackCount: tracks?.total ?? 0,
          url: external?.spotify ?? "",
        });
      }
    }

    let premium: boolean | undefined;
    if (meRes.ok) {
      const me = (await meRes.json()) as { product?: string };
      premium = me.product === "premium";
    }

    return {
      configured: true,
      ok: true,
      premium,
      nowPlaying,
      recent,
      playlists,
      fetchedAt: new Date().toISOString(),
      controlUnavailableReason:
        premium === false ? "Playback control requires Spotify Premium" : undefined,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      recent: [],
      playlists: [],
      error: error instanceof Error ? error.message : "Spotify request failed",
    };
  }
}

export type PlaybackAction = "play" | "pause" | "next" | "previous";

export async function controlPlayback(action: PlaybackAction): Promise<PlaybackResult> {
  if (!spotifyConfigured()) {
    return { ok: false, code: "not_configured", message: "Spotify is not connected." };
  }
  const route =
    action === "play"
      ? { path: "/me/player/play", method: "PUT" }
      : action === "pause"
        ? { path: "/me/player/pause", method: "PUT" }
        : action === "next"
          ? { path: "/me/player/next", method: "POST" }
          : { path: "/me/player/previous", method: "POST" };

  try {
    const response = await api(route.path, { method: route.method });
    if (response.status === 204 || response.status === 202) {
      return { ok: true, message: `Playback ${action}` };
    }
    if (response.status === 403) {
      return {
        ok: false,
        code: "premium_required",
        message: "Spotify only allows playback control on Premium accounts.",
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        code: "no_device",
        message: "No active Spotify device. Start playing on a device first.",
      };
    }
    return {
      ok: false,
      code: `http_${response.status}`,
      message: `Spotify returned ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      code: "network",
      message: error instanceof Error ? error.message : "Spotify request failed",
    };
  }
}
