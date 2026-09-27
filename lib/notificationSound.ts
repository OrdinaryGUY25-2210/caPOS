"use client";

/**
 * PRD §4C — Storage Audio Notifikasi Lokal.
 *
 * Berkas suara ASLI (bukan placeholder kosong) di public/assets/sounds/,
 * disintesis sebagai nada sederhana (bukan rekaman berlisensi pihak
 * ketiga) — lihat catatan di summary pengiriman soal ini. Next.js/Vercel
 * sudah menyajikan semua isi public/ lewat CDN dengan cache-control
 * agresif secara default, jadi "cache PWA/IndexedDB" di PRD tercapai
 * tanpa perlu Service Worker kustom tambahan.
 */

export const SOUND_TONES = [
  { value: "bell_chime", label: "Chime Bell" },
  { value: "digital_cash", label: "Digital Cash" },
  { value: "voice_alert", label: "Voice Alert" },
] as const;

export type SoundTone = (typeof SOUND_TONES)[number]["value"];

function soundUrl(tone: string) {
  const safe = SOUND_TONES.some((t) => t.value === tone) ? tone : "bell_chime";
  return `/assets/sounds/${safe}.mp3`;
}

// Preload sekali per nada di memori tab ini — panggilan play() berikutnya
// tinggal .cloneNode() dari elemen yang isi medianya sudah ter-fetch,
// menghindari network round-trip di detik kritis begitu event
// PAYMENT_SUCCESS diterima (PRD: harus terputar < 200ms).
const preloaded = new Map<string, HTMLAudioElement>();

function getPreloaded(tone: string): HTMLAudioElement {
  const url = soundUrl(tone);
  let el = preloaded.get(url);
  if (!el) {
    el = new Audio(url);
    el.preload = "auto";
    preloaded.set(url, el);
  }
  return el;
}

/**
 * Panggil ini SEKALI di titik interaksi pertama user (PRD contoh: tombol
 * "Buka Shift Kasir") — browser modern memblokir audio.play() yang belum
 * pernah "dilepas kuncinya" oleh gesture user (Autoplay Policy). Memuat
 * (preload) ketiga nada sekaligus di sini, bukan cuma yang sedang dipilih
 * saat ini, supaya ganti nada di pengaturan tidak perlu unlock ulang.
 */
export function unlockNotificationAudio() {
  for (const { value } of SOUND_TONES) {
    const el = getPreloaded(value);
    // play() lalu langsung pause+reset: ini "gesture unlock" standar,
    // BUKAN benar-benar memperdengarkan suara ke user.
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
      })
      .catch(() => {
        // Autoplay tetap diblokir (mis. browser lama) — playNotificationSound()
        // nanti akan gagal diam-diam juga (lihat catch di bawah), tidak fatal.
      });
  }
}

/**
 * Struktur eksekusi sesuai PRD §4C, disesuaikan dengan preload di atas
 * supaya latensinya serendah mungkin. `enabled=false` membuat fungsi ini
 * no-op (dicek di pemanggil juga, tapi dicek ulang di sini supaya aman
 * dipanggil langsung tanpa syarat dari titik manapun).
 */
export function playNotificationSound(tone: string, volume = 0.8, enabled = true) {
  if (!enabled) return;
  try {
    const base = getPreloaded(tone);
    // clone supaya beberapa notifikasi ber-tumpuk (jarang, tapi bisa
    // terjadi kalau 2 transaksi lunas nyaris bersamaan) tidak saling
    // memotong pemutaran satu sama lain.
    const instance = base.cloneNode(true) as HTMLAudioElement;
    instance.volume = Math.min(1, Math.max(0, volume));
    instance.currentTime = 0;
    instance.play().catch((err) => console.warn("Audio notifikasi diblokir browser:", err));
  } catch (err) {
    console.warn("Gagal memutar audio notifikasi:", err);
  }
}
