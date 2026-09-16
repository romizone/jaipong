"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { AlertTriangle, Library, Loader2 } from "lucide-react";
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
import {
  buildTimeline,
  type LineMark,
  type SectionMark,
} from "@/lib/audio/timeline";
import { audioBufferToWav, safeFilename } from "@/lib/audio/wav";
import { getAudio, putAudio } from "@/lib/client/audiodb";
import { readComposeStream } from "@/lib/client/stream";
import {
  deleteSong,
  getLibrary,
  getServerLibrary,
  saveSong,
  subscribeLibrary,
} from "@/lib/client/storage";
import { TrackPlayer } from "@/lib/client/track-player";
import {
  isTrack,
  type ComposeRequest,
  type LibraryItem,
  type SongPlan,
  type Track,
} from "@/lib/types";

type Draft = { title: string; lines: string[] };

async function httpError(res: Response): Promise<Error> {
  const detail = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  return new Error(detail?.error ?? "Lagu gagal disusun. Coba lagi.");
}

export function Studio() {
  // Pustaka hidup di localStorage; React yang menjaga cuplikannya tetap sinkron.
  const library = useSyncExternalStore(subscribeLibrary, getLibrary, getServerLibrary);
  const [current, setCurrent] = useState<LibraryItem | null>(null);

  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState("");
  /** Tahap yang sedang berjalan, untuk indikator langkah di kartu proses. */
  const [phase, setPhase] = useState<"plan" | "audio">("plan");
  const [draft, setDraft] = useState<Draft>({ title: "", lines: [] });
  const [error, setError] = useState<string | null>(null);

  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.9);
  // Pembaca lirik lagu synth lama mati bawaan — nadanya datar, terdengar
  // seperti membaca puisi di atas musik. Bisa dinyalakan lewat tombol mikrofon.
  const [singing, setSinging] = useState(false);
  /** Id lagu yang sedang disiapkan berkas unduhannya. */
  const [exportingId, setExportingId] = useState<string | null>(null);

  /**
   * Dua pemutar hidup berdampingan: TrackPlayer untuk lagu bermodel musik
   * (audio jadi), SongPlayer untuk lagu partitur dari versi sebelumnya.
   * Keduanya melapor ke state yang sama; hanya satu yang berbunyi.
   */
  const synthRef = useRef<SongPlayer | null>(null);
  const trackRef = useRef<TrackPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Blob lagu aktif — cadangan kalau IndexedDB tidak bisa dipakai. */
  const blobRef = useRef<{ id: string; blob: Blob } | null>(null);
  /** Bagian lagu aktif, untuk digulirkan ke pandangan begitu lagunya jadi. */
  const songSectionRef = useRef<HTMLElement | null>(null);
  /** Cermin posisi/durasi untuk pintasan keyboard, tanpa memicu render. */
  const positionRef = useRef(0);
  const durationRef = useRef(0);

  /* ------------------------------------------------------------ setup --- */

  useEffect(() => {
    const callbacks = {
      onPosition: (seconds: number) => {
        positionRef.current = seconds;
        setPosition(seconds);
      },
      onState: setPlayerState,
    };
    const synth = new SongPlayer(callbacks);
    const track = new TrackPlayer(callbacks);
    synthRef.current = synth;
    trackRef.current = track;
    warmSpeechVoices();

    return () => {
      synth.dispose();
      track.dispose();
      synthRef.current = null;
      trackRef.current = null;
    };
  }, []);

  /** Penanda lirik + durasi untuk panel dan bilah pemutar. */
  const view = useMemo(() => {
    if (!current) return null;
    if (isTrack(current)) {
      return { sections: trackSections(current), duration: current.durationSec };
    }
    const timeline = buildTimeline(current);
    return { sections: timeline.sections, duration: timeline.duration };
  }, [current]);

  useEffect(() => {
    durationRef.current = view?.duration ?? 0;
  }, [view]);

  /* ---------------------------------------------------------- menyusun --- */

  /**
   * Pasang trek yang baru jadi: dekode, simpan, langsung putar — dalam urutan
   * itu. Berkas yang ternyata tidak bisa didekode tidak pernah disimpan, jadi
   * IndexedDB tidak menimbun audio yang tidak akan pernah masuk pustaka.
   */
  const adoptTrack = useCallback(
    async (incoming: Track, blob: Blob, signal: AbortSignal) => {
      const player = trackRef.current;
      if (!player) return;

      setStatus("Menyiapkan pemutar…");
      try {
        await player.load(blob);
      } catch (caught) {
        console.error("[jaipong] audio tidak bisa didekode", caught);
        throw new Error(
          "Audio yang diterima tidak bisa diputar. Coba buat lagunya sekali lagi.",
        );
      }
      // Pengguna membatalkan (atau memulai lagu lain) selagi audionya didekode:
      // hasil yang sudah tidak diminta jangan disimpan, apalagi diputar.
      if (signal.aborted) return;

      const track =
        player.duration > 0 ? { ...incoming, durationSec: player.duration } : incoming;

      blobRef.current = { id: track.id, blob };
      const stored = await putAudio(track.id, blob);
      if (!stored) {
        // Tanpa IndexedDB lagunya tetap berbunyi sekarang, hanya tidak bisa
        // diputar lagi setelah halaman ditutup.
        console.warn("[jaipong] IndexedDB tidak tersedia; audio hanya untuk sesi ini");
      }

      synthRef.current?.stop();
      player.setVolume(volume);
      saveSong(track);
      setCurrent(track);
      setPosition(0);
      void player.play(0);

      // Gulirkan bagian lagu ke pandangan supaya lirik berjalannya terlihat —
      // di ponsel, pengguna masih berada di dekat formulir.
      setTimeout(() => {
        songSectionRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      }, 120);
    },
    [volume],
  );

  const compose = useCallback(
    async (request: ComposeRequest) => {
      // Kedua konteks audio dibuka di sini, selagi klik pengguna masih berlaku.
      synthRef.current?.unlock();
      trackRef.current?.unlock();

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setComposing(true);
      setError(null);
      setDraft({ title: "", lines: [] });
      setPhase("plan");
      setStatus("Menulis judul dan lirik…");

      try {
        /* Tahap 1: model bahasa menulis judul, gaya, dan lirik. */
        const planRes = await fetch("/api/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!planRes.ok) throw await httpError(planRes);

        let plan: SongPlan | null = null;
        for await (const event of readComposeStream(planRes, controller.signal)) {
          if (event.type === "status") setStatus(event.message);
          else if (event.type === "title")
            setDraft((d) => ({ ...d, title: event.title }));
          else if (event.type === "lyric")
            setDraft((d) => ({ ...d, lines: [...d.lines, event.line].slice(-14) }));
          else if (event.type === "plan") plan = event.plan;
          else if (event.type === "error") setError(event.message);
        }
        if (!plan || controller.signal.aborted) return;

        /* Tahap 2: model musik membangkitkan audionya. */
        setPhase("audio");
        setStatus("Membangkitkan audionya… biasanya sekitar satu menit.");
        const renderRes = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            duration: request.duration,
            instrumental: request.instrumental,
          }),
          signal: controller.signal,
        });
        if (!renderRes.ok) throw await httpError(renderRes);

        // Uint8Array<ArrayBuffer> eksplisit supaya diterima BlobPart.
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let mime = "audio/mpeg";
        let received = 0;

        for await (const event of readComposeStream(renderRes, controller.signal)) {
          if (event.type === "status") setStatus(event.message);
          else if (event.type === "audio-begin") mime = event.mime;
          else if (event.type === "audio") {
            const binary = atob(event.b64);
            const chunk = new Uint8Array(new ArrayBuffer(binary.length));
            for (let i = 0; i < binary.length; i += 1) chunk[i] = binary.charCodeAt(i);
            parts.push(chunk);
            received += chunk.length;
            setStatus(`Menerima audio… ${(received / 1_048_576).toFixed(1)} MB`);
          } else if (event.type === "error") setError(event.message);
          else if (event.type === "track") {
            await adoptTrack(
              event.track,
              new Blob(parts, { type: mime }),
              controller.signal,
            );
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
        // Hanya proses yang masih berlaku yang boleh mematikan indikatornya.
        // Proses yang sudah dibatalkan lalu digantikan proses baru jangan
        // sampai memadamkan kartu proses milik penggantinya.
        if (abortRef.current === controller) {
          abortRef.current = null;
          setComposing(false);
          setStatus("");
        }
      }
    },
    [adoptTrack],
  );

  const cancelCompose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setComposing(false);
    setStatus("");
  }, []);

  /* ----------------------------------------------------------- pemutar --- */

  const playSong = useCallback(
    async (item: LibraryItem) => {
      const synth = synthRef.current;
      const track = trackRef.current;
      if (!synth || !track) return;

      if (current?.id === item.id) {
        const player = isTrack(item) ? track : synth;
        if (player.currentState === "playing") player.pause();
        else void player.play();
        return;
      }

      setError(null);
      if (isTrack(item)) {
        synth.stop();
        track.unlock();
        const cached = blobRef.current?.id === item.id ? blobRef.current.blob : null;
        const blob = cached ?? (await getAudio(item.id));
        if (!blob) {
          setError(
            "Audio lagu ini tidak lagi tersimpan di browser ini. Buat ulang lagunya untuk mendengarnya lagi.",
          );
          return;
        }
        blobRef.current = { id: item.id, blob };

        let fixed = item;
        try {
          await track.load(blob);
        } catch (caught) {
          // Tanpa ini kegagalan dekode jadi unhandled rejection: tidak ada
          // yang terjadi di layar dan pengguna mengira tombolnya rusak.
          console.error("[jaipong] audio tersimpan tidak bisa didekode", caught);
          setError(
            "Audio lagu ini rusak dan tidak bisa diputar. Hapus lalu buat ulang lagunya.",
          );
          return;
        }
        if (track.duration > 0 && Math.abs(track.duration - item.durationSec) > 0.5) {
          fixed = { ...item, durationSec: track.duration };
          saveSong(fixed);
        }
        setCurrent(fixed);
        setPosition(0);
        track.setVolume(volume);
        void track.play(0);
      } else {
        track.stop();
        setCurrent(item);
        setPosition(0);
        synth.load(item);
        synth.setVolume(volume);
        synth.setSinging(singing);
        void synth.play(0);
      }
    },
    [current, singing, volume],
  );

  const toggle = useCallback(() => {
    if (!current) return;
    const player = isTrack(current) ? trackRef.current : synthRef.current;
    if (!player) return;
    if (player.currentState === "playing") player.pause();
    else void player.play();
  }, [current]);

  const seek = useCallback(
    (seconds: number) => {
      if (!current) return;
      const player = isTrack(current) ? trackRef.current : synthRef.current;
      player?.seek(seconds);
      setPosition(seconds);
    },
    [current],
  );

  const changeVolume = useCallback((value: number) => {
    setVolume(value);
    synthRef.current?.setVolume(value);
    trackRef.current?.setVolume(value);
  }, []);

  const toggleSinging = useCallback(() => {
    setSinging((on) => {
      synthRef.current?.setSinging(!on);
      return !on;
    });
  }, []);

  const remove = useCallback(
    (item: LibraryItem) => {
      deleteSong(item.id);
      if (blobRef.current?.id === item.id) blobRef.current = null;
      if (current?.id === item.id) {
        synthRef.current?.stop();
        trackRef.current?.stop();
        setCurrent(null);
        setPosition(0);
      }
    },
    [current],
  );

  /* ------------------------------------------------------------ unduh --- */

  const download = useCallback(
    async (item: LibraryItem) => {
      if (exportingId) return;
      setExportingId(item.id);
      try {
        let blob: Blob;
        let extension: string;
        if (isTrack(item)) {
          const cached = blobRef.current?.id === item.id ? blobRef.current.blob : null;
          const stored = cached ?? (await getAudio(item.id));
          if (!stored) {
            throw new Error("Audio lagu ini tidak lagi tersimpan di browser ini.");
          }
          blob = stored;
          extension = item.audioFormat;
        } else {
          // Lagu partitur lama dirender dulu jadi WAV oleh mesin synth.
          blob = audioBufferToWav(await renderSong(item));
          extension = "wav";
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${safeFilename(item.title)}.${extension}`;
        document.body.appendChild(link);
        link.click();

        // Elemennya dibiarkan sebentar di DOM: sebagian browser membatalkan
        // unduhan kalau <a>-nya dicabut sebelum unduhan sempat dimulai.
        setTimeout(() => link.remove(), 1_000);
        // Beri jeda sebelum melepas URL, kalau tidak unduhan bisa terputus.
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch (caught) {
        console.error(caught);
        setError(
          caught instanceof Error && caught.message.includes("tersimpan")
            ? caught.message
            : "Gagal menyiapkan berkas audio. Coba lagi.",
        );
      } finally {
        setExportingId(null);
      }
    },
    [exportingId],
  );

  const getAnalyser = useCallback(() => {
    if (current && isTrack(current)) return trackRef.current?.frequencyData ?? null;
    return synthRef.current?.frequencyData ?? null;
  }, [current]);

  /**
   * Cegah tab tertutup tak sengaja saat lagu sedang dibangkitkan — biaya
   * model musiknya sudah berjalan, sayang kalau hasilnya hilang.
   */
  useEffect(() => {
    if (!composing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [composing]);

  /** Pintasan gaya aplikasi musik: Spasi putar/jeda, panah geser 5 detik. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!current) return;

      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(Math.max(0, positionRef.current - 5));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(Math.min(durationRef.current, positionRef.current + 5));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, toggle, seek]);

  /* ------------------------------------------------------------ tampil --- */

  return (
    <>
      {/*
        Header selebar layar: pita bermerek dari tepi kiri sampai tepi kanan,
        ditutup garis aksen emas-mawar. Isinya tetap sejajar dengan kolom
        halaman — logo dan nama di kiri, tagline mengisi sisi kanan pada
        layar lebar.
      */}
      <header className="w-full border-b border-line bg-night-2/40">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-5 sm:gap-5 sm:px-6 sm:py-7">
          {/*
            Sudut membulat dan latarnya sudah menyatu di dalam PNG-nya, jadi
            tidak perlu rounded-xl tambahan — itu justru memotong sudutnya.
            alt kosong: teks "Jaipong" di sebelahnya sudah menyebut namanya.
          */}
          <Image
            src="/logo-icon.png"
            alt=""
            width={160}
            height={160}
            priority
            className="size-14 shrink-0 sm:size-20"
          />
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              Jaipong
            </h1>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.28em] text-gold/80 sm:text-sm">
              Studio Lagu AI
            </p>
          </div>
          <p className="ml-auto hidden max-w-sm text-right text-sm leading-relaxed text-muted lg:block">
            Tulis satu kalimat, dapatkan lagu utuh — lirik ditulis AI, lalu
            audionya dibangkitkan model musik.
          </p>
        </div>
        <div
          aria-hidden
          className="h-0.5 w-full bg-gradient-to-r from-gold/70 via-rose/50 to-transparent"
        />
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-36 pt-6 sm:px-6 sm:pt-8">
        {/* Di layar sempit tagline tidak muat di pita, jadi tampil di sini. */}
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted lg:hidden">
          Tulis satu kalimat, dapatkan lagu utuh — lirik ditulis AI, lalu
          audionya dibangkitkan model musik. Lagunya bisa langsung diputar dan
          diunduh sebagai berkas MP3.
        </p>

        {/*
          grid-cols-1 penting: tanpa minmax(0,1fr) eksplisit, lajur tunggal di
          ponsel melebar mengikuti lebar minimum isinya — baris genre+tag pada
          kartu pustaka yang nowrap membuat seluruh halaman meluber ke samping.
        */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:mt-0 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <div className="lg:sticky lg:top-6">
            <CreatePanel busy={composing} onSubmit={compose} onCancel={cancelCompose} />
          </div>

          <div className="space-y-6">
            {composing && <ComposingCard status={status} draft={draft} phase={phase} />}

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

            {current && view && (
              <section ref={songSectionRef} className="animate-rise scroll-mt-6">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-ink">
                    {current.title}
                  </h2>
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
                    {current.genreLabel}
                  </span>
                  {!isTrack(current) && (
                    <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
                      {current.key} {modeLabel(current.mode)} · {current.bpm} BPM
                    </span>
                  )}
                </div>
                <LyricsPanel
                  sections={view.sections}
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
                  <Image
                    src="/logo-icon.png"
                    alt=""
                    width={96}
                    height={96}
                    className="mx-auto size-12 opacity-70"
                  />
                  <p className="mt-3 text-sm text-muted">
                    Belum ada lagu. Tulis idenya di sebelah, lalu tekan{" "}
                    <span className="font-medium text-ink">Bikin Lagu</span>.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {library.map((item) => (
                    <SongCard
                      key={item.id}
                      song={item}
                      active={current?.id === item.id}
                      playing={current?.id === item.id && playerState === "playing"}
                      exporting={exportingId === item.id}
                      onPlay={() => void playSong(item)}
                      onDownload={() => void download(item)}
                      onDelete={() => remove(item)}
                    />
                  ))}
                </div>
              )}
            </section>

            <footer className="pt-2 text-[11px] leading-relaxed text-faint">
              <p>
                Lagu disimpan di browser ini saja — tidak ada akun dan tidak ada
                salinan di server. Membersihkan data situs berarti menghapus
                pustakanya beserta audionya.
              </p>
              <p className="mt-1.5">
                Audio dibangkitkan model musik lewat OpenRouter. Lagu dari versi
                sebelumnya tetap bisa diputar dengan mesin synth lama.
              </p>
            </footer>
          </div>
        </div>
      </div>

      <PlayerBar
        song={current}
        state={playerState}
        position={position}
        duration={view?.duration ?? 0}
        volume={volume}
        singing={singing}
        exporting={current ? exportingId === current.id : false}
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
function ComposingCard({
  status,
  draft,
  phase,
}: {
  status: string;
  draft: Draft;
  phase: "plan" | "audio";
}) {
  const activeStep = phase === "plan" ? 0 : 1;

  return (
    <div role="status" className="animate-rise rounded-xl2 border border-gold/25 bg-gold/6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5 text-sm font-medium text-gold-soft">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {status || "Menyusun lagu…"}
        </div>

        {/* Dua langkah: lirik ditulis dulu, baru audionya dibangkitkan. */}
        <div className="flex items-center gap-2" aria-hidden>
          {["Lirik", "Audio"].map((label, index) => (
            <div key={label} className="flex items-center gap-2">
              {index > 0 && <span className="h-px w-5 bg-line" />}
              <span
                className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                  index === activeStep
                    ? "text-gold-soft"
                    : index < activeStep
                      ? "text-muted"
                      : "text-faint"
                }`}
              >
                <span
                  className={`flex size-4 items-center justify-center rounded-full text-[9px] ${
                    index === activeStep
                      ? "bg-gold text-night"
                      : index < activeStep
                        ? "bg-gold/40 text-night"
                        : "border border-line"
                  }`}
                >
                  {index < activeStep ? "✓" : index + 1}
                </span>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Kilau berjalan: ada kemajuan walau belum ada angka pastinya. */}
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
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

/* --------------------------------------------------- lirik trek berwaktu --- */

/**
 * Baris tanpa detik diisi lewat interpolasi: linear di antara dua jangkar
 * yang punya detik, mundur/maju bertahap di luar jangkar, dan sebaran rata
 * kalau model tidak memberi waktu sama sekali.
 */
function fillStarts(starts: number[], duration: number): number[] {
  const n = starts.length;
  const known: number[] = [];
  for (let i = 0; i < n; i += 1) if (starts[i]! >= 0) known.push(i);

  if (!known.length) {
    for (let i = 0; i < n; i += 1) {
      starts[i] = duration * (0.06 + (0.86 * i) / Math.max(1, n - 1));
    }
    return starts;
  }

  const first = known[0]!;
  for (let i = 0; i < first; i += 1) {
    starts[i] = Math.max(0, starts[first]! - (first - i) * 3.5);
  }
  for (let k = 0; k + 1 < known.length; k += 1) {
    const a = known[k]!;
    const b = known[k + 1]!;
    for (let i = a + 1; i < b; i += 1) {
      starts[i] = starts[a]! + ((starts[b]! - starts[a]!) * (i - a)) / (b - a);
    }
  }
  const last = known[known.length - 1]!;
  const remaining = n - 1 - last;
  if (remaining > 0) {
    const step = Math.min(
      3.5,
      Math.max(1, (duration * 0.96 - starts[last]!) / (remaining + 1)),
    );
    for (let i = last + 1; i < n; i += 1) {
      starts[i] = Math.min(duration, starts[last]! + (i - last) * step);
    }
  }
  return starts;
}

/** Susun penanda lirik untuk panel dari baris berwaktu model musik. */
function trackSections(track: Track): SectionMark[] {
  const duration = Math.max(1, track.durationSec || 1);
  const lines = track.lines.filter((line) => line.text.trim());

  const starts = fillStarts(
    lines.map((line) =>
      typeof line.start === "number" && Number.isFinite(line.start)
        ? Math.min(duration, Math.max(0, line.start))
        : -1,
    ),
    duration,
  );

  const marks: LineMark[] = lines.map((line, index) => ({
    text: line.text,
    start: starts[index]!,
    end: index + 1 < lines.length ? starts[index + 1]! : Math.min(duration, starts[index]! + 4),
    syllables: [],
  }));

  return [
    {
      id: "lirik",
      label: "Lirik",
      type: "verse",
      start: 0,
      end: duration,
      lines: marks,
    },
  ];
}
