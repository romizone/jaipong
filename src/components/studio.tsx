"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertTriangle, Disc3, Library, Loader2, Music2 } from "lucide-react";
import { CreatePanel } from "@/components/create-panel";
import { LyricsPanel } from "@/components/lyrics-panel";
import { PlayerBar, modeLabel } from "@/components/player-bar";
import { SongCard } from "@/components/song-card";
import {
  SongPlayer,
  renderSong,
  warmSpeechVoices,
  type PlayerState,
} from "@/lib/audio/engine";
import { buildTimeline } from "@/lib/audio/timeline";
import { audioBufferToWav, safeFilename } from "@/lib/audio/wav";
import { readComposeStream } from "@/lib/client/stream";
import {
  deleteSong,
  getLibrary,
  getServerLibrary,
  saveSong,
  subscribeLibrary,
} from "@/lib/client/storage";
import type { ComposeRequest, Song } from "@/lib/types";

type Draft = { title: string; lines: string[] };

export function Studio() {
  // Pustaka hidup di localStorage; React yang menjaga cuplikannya tetap sinkron.
  const library = useSyncExternalStore(subscribeLibrary, getLibrary, getServerLibrary);
  const [current, setCurrent] = useState<Song | null>(null);

  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<Draft>({ title: "", lines: [] });
  const [error, setError] = useState<string | null>(null);

  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [singing, setSinging] = useState(true);
  /** Id lagu yang sedang dirender jadi WAV — satu ekspor pada satu waktu. */
  const [exportingId, setExportingId] = useState<string | null>(null);

  const playerRef = useRef<SongPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ------------------------------------------------------------ setup --- */

  useEffect(() => {
    const player = new SongPlayer({
      onPosition: setPosition,
      onState: setPlayerState,
    });
    playerRef.current = player;
    warmSpeechVoices();

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  const timeline = useMemo(() => (current ? buildTimeline(current) : null), [current]);

  /* ---------------------------------------------------------- menyusun --- */

  const compose = useCallback(async (request: ComposeRequest) => {
    // Konteks audio dibuka di sini, selagi klik pengguna masih berlaku.
    playerRef.current?.unlock();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setComposing(true);
    setError(null);
    setDraft({ title: "", lines: [] });
    setStatus("Menyiapkan ide lagu…");

    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(detail?.error ?? "Lagu gagal disusun. Coba lagi.");
      }

      for await (const event of readComposeStream(response, controller.signal)) {
        if (event.type === "status") setStatus(event.message);
        else if (event.type === "title") setDraft((d) => ({ ...d, title: event.title }));
        else if (event.type === "lyric")
          setDraft((d) => ({ ...d, lines: [...d.lines, event.line].slice(-14) }));
        else if (event.type === "error") setError(event.message);
        else if (event.type === "song") {
          saveSong(event.song);
          setCurrent(event.song);
          const player = playerRef.current;
          if (player) {
            player.load(event.song);
            player.setVolume(volume);
            player.setSinging(singing);
            void player.play(0);
          }
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Lagu gagal disusun. Coba lagi sebentar lagi.",
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setComposing(false);
      setStatus("");
    }
  }, [singing, volume]);

  const cancelCompose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setComposing(false);
    setStatus("");
  }, []);

  /* ----------------------------------------------------------- pemutar --- */

  const playSong = useCallback(
    (song: Song) => {
      const player = playerRef.current;
      if (!player) return;

      if (current?.id === song.id) {
        if (player.currentState === "playing") player.pause();
        else void player.play();
        return;
      }

      setCurrent(song);
      setPosition(0);
      player.load(song);
      player.setVolume(volume);
      player.setSinging(singing);
      void player.play(0);
    },
    [current, singing, volume],
  );

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (!player || !current) return;
    if (player.currentState === "playing") player.pause();
    else void player.play();
  }, [current]);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seek(seconds);
    setPosition(seconds);
  }, []);

  const changeVolume = useCallback((value: number) => {
    setVolume(value);
    playerRef.current?.setVolume(value);
  }, []);

  const toggleSinging = useCallback(() => {
    setSinging((on) => {
      playerRef.current?.setSinging(!on);
      return !on;
    });
  }, []);

  const remove = useCallback(
    (song: Song) => {
      deleteSong(song.id);
      if (current?.id === song.id) {
        playerRef.current?.stop();
        setCurrent(null);
        setPosition(0);
      }
    },
    [current],
  );

  /* ------------------------------------------------------------ unduh --- */

  /**
   * Render satu lagu jadi WAV lalu serahkan ke browser. Lagunya diterima
   * sebagai argumen, bukan diambil dari "current", supaya kartu di pustaka
   * bisa mengunduh tanpa harus memutarnya lebih dulu.
   */
  const download = useCallback(
    async (song: Song) => {
      if (exportingId) return;
      setExportingId(song.id);
      try {
        const buffer = await renderSong(song);
        const blob = audioBufferToWav(buffer);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${safeFilename(song.title)}.wav`;
        document.body.appendChild(link);
        link.click();

        // Elemennya dibiarkan sebentar di DOM: sebagian browser membatalkan
        // unduhan kalau <a>-nya dicabut sebelum unduhan sempat dimulai.
        setTimeout(() => link.remove(), 1_000);
        // Beri jeda sebelum melepas URL, kalau tidak unduhan bisa terputus.
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch (caught) {
        console.error(caught);
        setError("Gagal menyiapkan berkas WAV. Coba lagi.");
      } finally {
        setExportingId(null);
      }
    },
    [exportingId],
  );

  const getAnalyser = useCallback(() => playerRef.current?.frequencyData ?? null, []);

  /* ------------------------------------------------------------ tampil --- */

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pb-36 pt-8 sm:px-6 sm:pt-12">
        <header>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-rose text-night">
              <Disc3 size={19} aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-ink">Jaipong</h1>
              <p className="text-[11px] font-medium uppercase tracking-widest text-gold/70">
                Studio Lagu AI
              </p>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
            Tulis satu kalimat, dapatkan lagu utuh — lirik, melodi, akor, dan
            aransemennya sekaligus. Lagunya dibunyikan langsung di browser kamu,
            dan bisa diunduh sebagai berkas WAV.
          </p>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <div className="lg:sticky lg:top-6">
            <CreatePanel busy={composing} onSubmit={compose} onCancel={cancelCompose} />
          </div>

          <div className="space-y-6">
            {composing && <ComposingCard status={status} draft={draft} />}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl2 border border-rose/40 bg-rose/10 p-4 text-sm text-ink"
              >
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose" aria-hidden />
                <div className="flex-1">{error}</div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="text-xs text-muted hover:text-ink"
                >
                  Tutup
                </button>
              </div>
            )}

            {current && timeline && (
              <section className="animate-rise">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-ink">
                    {current.title}
                  </h2>
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
                    {current.genreLabel}
                  </span>
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
                    {current.key} {modeLabel(current.mode)} · {current.bpm} BPM
                  </span>
                </div>
                <LyricsPanel
                  sections={timeline.sections}
                  position={position}
                  playing={playerState === "playing"}
                  onSeek={seek}
                />
              </section>
            )}

            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
                <Library size={15} aria-hidden />
                Pustaka lagu
                {library.length > 0 && (
                  <span className="text-faint">({library.length})</span>
                )}
              </h2>

              {library.length === 0 ? (
                <div className="rounded-xl2 border border-dashed border-line p-8 text-center">
                  <Music2 size={22} className="mx-auto text-faint" aria-hidden />
                  <p className="mt-3 text-sm text-muted">
                    Belum ada lagu. Tulis idenya di sebelah, lalu tekan{" "}
                    <span className="text-ink">Buat Lagu</span>.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {library.map((song) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      active={current?.id === song.id}
                      playing={current?.id === song.id && playerState === "playing"}
                      exporting={exportingId === song.id}
                      onPlay={() => playSong(song)}
                      onDownload={() => void download(song)}
                      onDelete={() => remove(song)}
                    />
                  ))}
                </div>
              )}
            </section>

            <footer className="pt-2 text-[11px] leading-relaxed text-faint">
              <p>
                Lagu disimpan di browser ini saja — tidak ada akun dan tidak ada
                salinan di server. Membersihkan data situs berarti menghapus
                pustakanya.
              </p>
              <p className="mt-1.5">
                Suara dibangkitkan Web Audio API, bukan rekaman manusia. Kualitasnya
                terdengar seperti sintesis, bukan studio.
              </p>
            </footer>
          </div>
        </div>
      </div>

      <PlayerBar
        song={current}
        state={playerState}
        position={position}
        duration={timeline?.duration ?? 0}
        volume={volume}
        singing={singing}
        exporting={exportingId === current?.id}
        getAnalyser={getAnalyser}
        onToggle={toggle}
        onRestart={() => seek(0)}
        onSeek={seek}
        onVolume={changeVolume}
        onToggleSinging={toggleSinging}
        onDownload={() => current && void download(current)}
      />
    </>
  );
}

/** Kartu proses: menunjukkan lagu sedang ditulis, bukan sekadar memutar spinner. */
function ComposingCard({ status, draft }: { status: string; draft: Draft }) {
  return (
    <div className="animate-rise rounded-xl2 border border-gold/25 bg-gold/6 p-5">
      <div className="flex items-center gap-2.5 text-sm font-medium text-gold-soft">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        {status || "Menyusun lagu…"}
      </div>

      {draft.title && (
        <p className="mt-3 text-lg font-bold tracking-tight text-ink">{draft.title}</p>
      )}

      {draft.lines.length > 0 && (
        <div className="mt-2 space-y-0.5" aria-live="polite">
          {draft.lines.map((line, index) => (
            <p
              key={`${index}-${line}`}
              className="animate-rise text-sm text-muted"
              style={{ opacity: 0.4 + (index / draft.lines.length) * 0.6 }}
            >
              {line}
            </p>
          ))}
        </div>
      )}

      {!draft.title && !draft.lines.length && (
        <div className="mt-3 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="animate-breathe size-2 rounded-full bg-gold/60"
              style={{ animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
