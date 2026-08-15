/**
 * Spotify panel for the Focus page.
 *
 * Every control is either functional or disabled with the real reason:
 *   - not configured on the server
 *   - not synced yet in this browser
 *   - the account is not Premium, which Spotify requires for playback control
 *   - no active device
 */

import { Link } from "@tanstack/react-router";
import { Music2, Pause, Play, RefreshCw, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlaybackResult } from "@/lib/integrations/contracts";
import { useProviderConfig, useSync } from "@/lib/integrations/use-integrations";

const FOCUS_PLAYLIST_KEY = "aaditos:focus-playlist";

type Action = "play" | "pause" | "next" | "previous";

export function SpotifyPanel() {
  const config = useProviderConfig();
  const { sync, running, lastPayload } = useSync();
  const [busy, setBusy] = useState<Action | null>(null);
  const [playlistId, setPlaylistId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(FOCUS_PLAYLIST_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const spotify = lastPayload?.spotify;
  const configured = config.data?.spotify ?? false;

  const controlReason = !configured
    ? "Spotify is not configured on the server."
    : !spotify
      ? "Sync Spotify first to see the current device."
      : spotify.premium === false
        ? "Spotify only allows playback control on Premium accounts."
        : !spotify.ok
          ? (spotify.error ?? "The last Spotify request failed.")
          : null;

  async function control(action: Action) {
    setBusy(action);
    try {
      const response = await fetch("/api/spotify/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as PlaybackResult;
      if (result.ok) {
        toast.success(result.message);
        void sync(["spotify"]);
      } else {
        toast.error("Playback unavailable", { description: result.message });
      }
    } catch {
      toast.error("Could not reach Spotify");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Focus soundtrack"
        meta={
          configured ? (spotify?.premium === false ? "Free account" : undefined) : "Not configured"
        }
        action={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[12px]"
            disabled={!configured || running}
            title={configured ? undefined : "Add Spotify credentials on the server first"}
            onClick={() => void sync(["spotify"])}
          >
            <RefreshCw className={running ? "size-3 animate-spin" : "size-3"} aria-hidden />
            Sync
          </Button>
        }
      />

      {!configured ? (
        <EmptyState
          icon={Music2}
          title="Spotify is not connected"
          description="Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN on the server to see now playing and choose a focus playlist."
          action={
            <Button size="sm" variant="outline" className="h-8 text-[12.5px]" asChild>
              <Link to="/integrations">Integration setup</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3 px-4 py-3">
          {spotify?.nowPlaying ? (
            <div className="flex items-center gap-3">
              {spotify.nowPlaying.imageUrl ? (
                <img
                  src={spotify.nowPlaying.imageUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="size-10 shrink-0 rounded-[6px] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-[6px] border border-border text-muted-foreground"
                >
                  <Music2 className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{spotify.nowPlaying.title}</p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {spotify.nowPlaying.artist}
                  {spotify.nowPlaying.device ? ` · ${spotify.nowPlaying.device}` : ""}
                </p>
              </div>
              <Pill tone={spotify.nowPlaying.isPlaying ? "primary" : "neutral"}>
                {spotify.nowPlaying.isPlaying ? "Playing" : "Paused"}
              </Pill>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              {spotify ? "Nothing is playing right now." : "Not synced yet in this browser."}
            </p>
          )}

          <div className="flex items-center gap-1.5">
            {(
              [
                ["previous", SkipBack, "Previous track"],
                [
                  spotify?.nowPlaying?.isPlaying ? "pause" : "play",
                  spotify?.nowPlaying?.isPlaying ? Pause : Play,
                  spotify?.nowPlaying?.isPlaying ? "Pause" : "Play",
                ],
                ["next", SkipForward, "Next track"],
              ] as Array<[Action, typeof Play, string]>
            ).map(([action, Icon, label]) => (
              <Button
                key={label}
                size="icon"
                variant="outline"
                className="size-8"
                aria-label={label}
                title={controlReason ?? label}
                disabled={Boolean(controlReason) || busy !== null}
                onClick={() => void control(action)}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
            {controlReason ? (
              <span className="ml-1 min-w-0 text-[11.5px] text-muted-foreground">
                {controlReason}
              </span>
            ) : null}
          </div>

          {spotify?.playlists && spotify.playlists.length > 0 ? (
            <div>
              <label
                htmlFor="focus-playlist"
                className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Focus playlist
              </label>
              <Select
                value={playlistId}
                onValueChange={(value) => {
                  setPlaylistId(value);
                  try {
                    window.localStorage.setItem(FOCUS_PLAYLIST_KEY, value);
                  } catch {
                    /* storage unavailable */
                  }
                  toast.success("Focus playlist saved");
                }}
              >
                <SelectTrigger id="focus-playlist" className="h-8 text-[12.5px]">
                  <SelectValue placeholder="Pick a playlist" />
                </SelectTrigger>
                <SelectContent>
                  {spotify.playlists.map((playlist) => (
                    <SelectItem key={playlist.id} value={playlist.id}>
                      {playlist.name} · {playlist.trackCount} tracks
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Saved on this device and shown when you start a session.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
