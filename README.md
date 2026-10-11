# Jaipong

Studio lagu AI: tulis satu kalimat, dapatkan lagu utuh — judul, lirik, akor,
melodi, dan aransemennya sekaligus. Lagunya langsung berbunyi di browser dan
bisa diunduh sebagai berkas WAV.

Dibuat dengan Next.js 16 + OpenRouter, mengikuti pola yang sama dengan
[somat.rominur.com](https://somat.rominur.com).

## Cara kerjanya

Penyusunan lagu berjalan dua tahap, dua-duanya lewat OpenRouter:

| Tahap | Model | Yang dihasilkan |
| --- | --- | --- |
| 1. `/api/compose` | Model bahasa (bawaan: Gemini Flash) | Judul, genre, deskripsi gaya, dan lirik — dialirkan baris demi baris ke layar |
| 2. `/api/render` | Model musik (bawaan: **Lyria 3 Pro**) | Audio jadi (MP3 stereo 44,1 kHz) beserta lirik berwaktu |

Rencana dari tahap pertama ditulis dalam format baris-per-baris, bukan JSON —
supaya bisa dialirkan ke layar begitu tiap barisnya selesai, dan keluaran yang
terpotong pun tetap terpakai tanpa perlu perbaikan JSON:

```
JUDUL: Goyang Panen Rampak
GENRE: Jaipong Sunda
TAG: jaipong, kendang sunda, suling, ceria
VOKAL: wanita
GAYA: Jaipong Sunda bertempo lincah sekitar 120 BPM, kendang rapat, suling …
LIRIK:
[Verse 1]
Pare koneng di sawah
Hate bungah sumringah
```

Tahap kedua mengirim rencana itu ke model musik dan menerima audionya sebagai
aliran base64 lewat SSE, plus lirik berwaktu (`[12.0:] Pare koneng di sawah`)
yang menggerakkan panel lirik. Audionya disimpan di IndexedDB browser —
tidak ada salinan di server.

Vokalnya nyanyian sungguhan dari model musik, bukan sintesis formant. Mesin
synth Web Audio yang lama tetap ada untuk memutar lagu-lagu partitur yang
dibuat versi sebelumnya.

## Menjalankan

```bash
npm install
cp .env.example .env.local   # isi OPENROUTER_API_KEY
npm run dev
```

Buka http://localhost:3000.

### Konfigurasi

Yang wajib:

```
OPENROUTER_API_KEY=sk-or-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=...            # openssl rand -base64 32
```

Selebihnya opsional dan sudah ada nilai bawaannya — lihat [.env.example](.env.example)
untuk pilihan model dan batas kuota. Tidak ada satu pun variabel yang
di-prefix `NEXT_PUBLIC_`, jadi nama model dan kunci tidak pernah sampai ke
browser.

**Biaya.** Model musiknya dibayar per lagu (Lyria 3 Pro ± $0,08/lagu), bukan
per token. Kuota bawaan 150 lagu global per hari menjadikan plafon terburuknya
sekitar $12/hari — atur lewat `COMPOSE_GLOBAL_DAILY_LIMIT` sesuai anggaran.

Kuota per IP disimpan di memori proses. Di Vercel tiap instance punya memorinya
sendiri, jadi batasnya bisa lebih longgar dari angka yang tertulis. Isi
`UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` kalau butuh kuota yang
persis.

### Masuk, jatah, dan catatan pemakaian

Membuat lagu mensyaratkan masuk dengan Google, dan tiap akun dibatasi
`USER_DAILY_LIMIT` lagu per hari (bawaan 5, hari dihitung menurut WIB). Lagu
yang gagal di sisi layanan tidak memotong jatah.

- Di Google Cloud Console, daftarkan `<alamat situs>/api/auth/callback/google`
  sebagai *Authorized redirect URI* pada OAuth client-nya.
- Sesi disimpan di cookie bertanda tangan (`AUTH_SECRET`) — tanpa pustaka
  auth dan tanpa tabel sesi.
- Tiap pemanggilan model musik dicatat (siapa, kapan, judul, hasilnya), dan
  tiap akun punya satu catatan pengguna (pertama/terakhir masuk, jumlah lagu).
  Pengelola yang emailnya ada di `ADMIN_EMAILS` melihatnya di `/admin`.
- **Isi Upstash di produksi.** Jatah per akun, daftar pengguna, dan catatan
  pemakaian disimpan di Upstash Redis. Tanpa itu semuanya hanya hidup di
  memori tiap instance serverless: jatahnya bocor dan catatannya hilang.

## Peta berkas

```
src/
  app/
    api/compose/route.ts   Tahap 1 (SSE): status, judul, baris lirik, lalu rencana lagu
    api/render/route.ts    Tahap 2 (SSE): audio dari model musik, berpotongan base64
    api/health/route.ts    Cek konfigurasi tanpa membocorkan kunci
    api/auth/              Masuk dengan Google: login, callback, logout, me
    api/log/route.ts       Daftar pengguna + catatan pemakaian (khusus pengelola)
    admin/page.tsx         Halaman pengelola
    page.tsx layout.tsx    Halaman studio
    error.tsx              Jaring pengaman kalau halaman gagal dirender
  lib/
    config.ts              Semua env var, hanya sisi server
    openrouter.ts          Klien OpenRouter + terjemahan pesan kesalahan
    prompt.ts              Instruksi kedua tahap — di sinilah kualitas lagu ditentukan
    plan.ts                Pengurai rencana yang mengalir + lirik berwaktu dari model musik
    auth.ts                Cookie sesi bertanda tangan
    ratelimit.ts           Jatah per akun + kuota per IP (memori, atau Upstash kalau diisi)
    usagelog.ts users.ts   Catatan pemakaian dan daftar pengguna
    client/
      storage.ts           Metadata pustaka di localStorage
      audiodb.ts           Audio per lagu di IndexedDB
      track-player.ts      Pemutar trek: decode ke AudioBuffer, analyser, seek
      stream.ts            Pembaca SSE di sisi browser
    audio/                 Mesin synth lama — tetap ada untuk lagu partitur lama
      theory.ts instruments.ts drums.ts grooves.ts timeline.ts engine.ts wav.ts
```

## Catatan rancangan

**Dua endpoint, bukan satu.** Tahap lirik dan tahap audio dipisah supaya
masing-masing selesai jauh di bawah batas waktu fungsi serverless; kuota yang
mahal (per lagu) ditegakkan di `/api/render`, tempat biayanya benar-benar
terjadi.

**Format rencana anti-terpotong.** Rencana lagu ditulis baris-per-baris, bukan
JSON. Keluaran model yang putus di tengah tidak butuh perbaikan apa pun —
baris yang sudah utuh tetap terpakai, dan pengurainya (`src/lib/plan.ts`)
mengalirkan judul serta tiap baris lirik ke layar begitu selesai ditulis.

**Jangan percaya parameter, percaya berkas.** Model musik diminta WAV tapi
mengirim MP3; formatnya ditebak dari byte pertama berkasnya, bukan dari
parameter permintaan.

**Trek diputar lewat Web Audio, bukan `<audio>`.** MP3-nya didekode penuh ke
`AudioBuffer` (`src/lib/client/track-player.ts`). Mulai putarnya tunduk pada
AudioContext yang sudah dibuka saat pengguna mengeklik — bukan pada kebijakan
autoplay elemen media, yang menolak `play()` semenit setelah klik terakhir —
dan visualizer memakai analyser yang sama dengan pemutar lama.

**Audio milik browser pengguna.** Metadata pustaka di localStorage, berkas
audionya di IndexedDB; lagu yang tergusur dari pustaka ikut menghapus
audionya. Server tidak menyimpan apa pun.

**Mesin synth lama tidak dibuang.** Lagu partitur dari versi sebelumnya tetap
bisa diputar dan diekspor WAV; `src/lib/audio/` utuh dan hanya dipakai untuk
itu.

## Lisensi

MIT.
