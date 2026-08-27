# Jaipong

Studio lagu AI: tulis satu kalimat, dapatkan lagu utuh — judul, lirik, akor,
melodi, dan aransemennya sekaligus. Lagunya langsung berbunyi di browser dan
bisa diunduh sebagai berkas WAV.

Dibuat dengan Next.js 16 + OpenRouter, mengikuti pola yang sama dengan
[somat.rominur.com](https://somat.rominur.com).

## Cara kerjanya

OpenRouter menyalurkan model bahasa dan gambar — **tidak ada model musik di
sana**, jadi lagunya tidak bisa dibangkitkan sebagai audio seperti Suno.
Jaipong membagi pekerjaannya jadi dua:

| Bagian | Siapa yang mengerjakan | Di mana |
| --- | --- | --- |
| Judul, lirik, tempo, nada dasar, akor, melodi, pilihan instrumen | Model bahasa lewat OpenRouter | Server |
| Bunyi: synth, drum, vokal formant, reverb, mixing, ekspor WAV | Web Audio API | Browser pengguna |

Model tidak membuat audio — ia menulis **partitur** dalam bentuk JSON:

```jsonc
{
  "title": "Senja di Ciwidey",
  "bpm": 112, "key": "A", "mode": "pelog", "groove": "jaipong",
  "instruments": { "lead": "vocal", "chords": "gamelan", "bass": "bass_round", "arp": "gamelan" },
  "sections": [{
    "id": "verse1", "type": "verse", "label": "Verse 1", "bars": 8, "energy": 0.55,
    "chords": ["Am","Am","F","F","C","C","G","G"],
    "lines": [{
      "text": "Senja turun di Ciwidey",
      "notes": [ { "d": 3, "t": 0, "l": 0.5, "s": "Sen" }, { "d": 3, "t": 0.5, "l": 0.5, "s": "ja" } ]
    }]
  }]
}
```

`d` adalah derajat tangga nada (1 = nada dasar), `t` ketukan mulai, `l` panjang
nada, `s` suku kata yang dinyanyikan. Karena nadanya ditulis sebagai derajat —
bukan nomor MIDI — melodinya selalu masuk kunci, apa pun yang dikarang model.

Suaranya adalah sintesis, bukan rekaman manusia. Terdengar seperti synth yang
menyanyi, bukan seperti penyanyi di studio.

## Menjalankan

```bash
npm install
cp .env.example .env.local   # isi OPENROUTER_API_KEY
npm run dev
```

Buka http://localhost:3000.

### Konfigurasi

Hanya satu yang wajib:

```
OPENROUTER_API_KEY=sk-or-...
```

Selebihnya opsional dan sudah ada nilai bawaannya — lihat [.env.example](.env.example)
untuk pilihan model, pagar aransemen, dan batas kuota. Tidak ada satu pun
variabel yang di-prefix `NEXT_PUBLIC_`, jadi nama model dan kunci tidak pernah
sampai ke browser.

Kuota per IP disimpan di memori proses. Di Vercel tiap instance punya memorinya
sendiri, jadi batasnya bisa lebih longgar dari angka yang tertulis. Isi
`UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` kalau butuh kuota yang
persis.

## Peta berkas

```
src/
  app/
    api/compose/route.ts   Alirkan penyusunan lagu (SSE): status, judul, lirik, partitur
    api/health/route.ts    Cek konfigurasi tanpa membocorkan kunci
    page.tsx layout.tsx    Halaman studio
    error.tsx              Jaring pengaman kalau halaman gagal dirender
  lib/
    config.ts              Semua env var, hanya sisi server
    openrouter.ts          Klien OpenRouter + terjemahan pesan kesalahan
    prompt.ts              Instruksi penyusun lagu — di sinilah kualitas lagu ditentukan
    song.ts                Perbaiki dan jepit JSON dari model jadi lagu yang pasti bisa dimainkan
    ratelimit.ts           Kuota per IP (memori, atau Upstash kalau diisi)
    audio/
      theory.ts            Tangga nada, simbol akor, voicing
      instruments.ts       25 suara: vokal formant, suling, gamelan, bass, pad, …
      drums.ts             Perkusi sintetis, termasuk kendang dan gong
      grooves.ts           Pola ketukan per genre
      timeline.ts          Partitur -> daftar peristiwa berwaktu (bas, arpeggio, drum, isian)
      engine.ts            Bus, reverb, delay, pembatas puncak; pemutar + render offline
      wav.ts               AudioBuffer -> WAV 16-bit
```

## Catatan rancangan

**Model tidak dipercaya begitu saja.** `src/lib/song.ts` menjepit setiap nilai
ke rentang aman, memperbaiki JSON yang terpotong karena kehabisan token,
mengulang akor supaya jumlahnya pas dengan birama, dan membuatkan melodi
cadangan untuk baris lirik yang tidak diberi nada. Fungsi normalisasinya tidak
pernah melempar kesalahan — paling buruk ia mengembalikan `null`.

**Penjadwalan bertahap.** Lagu tiga menit berisi ribuan peristiwa audio.
Menjadwalkannya sekaligus membuat browser tersendat, jadi pemutar hanya
menjadwalkan sekitar 1,4 detik ke depan setiap 120 milidetik.

**Puncak dijaga.** Bus melewati kompresor lalu pembatas berbentuk kurva tanh,
jadi campuran seramai apa pun tidak pernah melewati 0 dBFS.

**Ukuran birama ikut groove.** Hampir semuanya 4/4; `waltz` 3/4. Angkanya
diturunkan dari groove (`beatsPerBar` di `src/lib/types.ts`), bukan disimpan
di lagu, jadi lagu lama di localStorage tetap terbaca.

**Dawai dihitung sendiri.** Petikan gitar, harpa, dan arpeggio memakai
Karplus-Strong yang dihitung langsung ke dalam buffer. Cara yang lebih
ringkas — `DelayNode` berumpan balik dengan `delayTime = 1/freq` — tidak bisa
dipakai: Web Audio menjepit delay di dalam siklus ke satu render quantum
(sekitar 2,9 ms), jadi semua nada di atas ~345 Hz akan keluar dengan tinggi
nada yang sama.

**Vokal ada dua lapis.** Melodi dibawakan synth formant (tiga filter bandpass
mengikuti vokal a/i/u/e/o dari suku katanya) — lapisan inilah yang ikut terekam
ke WAV. Di atasnya, `SpeechSynthesis` mengucapkan liriknya saat diputar
langsung; ini bisa dimatikan lewat tombol mikrofon dan memang tidak ikut
terekspor, karena browser tidak mengalirkannya lewat Web Audio.

**Kalau nanti ada model musik sungguhan.** Semua yang berhubungan dengan
penyedia terkumpul di `src/lib/openrouter.ts` dan `src/app/api/compose/route.ts`.
Menambah penyedia audio nyata berarti menambah satu jalur di sana, tanpa
menyentuh mesin audionya.

## Lisensi

MIT.
