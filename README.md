# Web Download

Web downloader sederhana untuk mengunduh video dari berbagai platform seperti TikTok, YouTube, Instagram, dan Twitter/X.

Project ini menggunakan:
- Node.js
- Express
- yt-dlp
- OpenAI Whisper (untuk fitur transkrip)
- Frontend sederhana berbasis HTML/CSS/JS

---

## ✨ Fitur

- Download video dari:
  - TikTok
  - YouTube
  - Instagram
  - Twitter / X
- Tanpa watermark (tergantung sumber)
- Fitur transkrip (menggunakan Whisper)
- Tampilan UI modern
- Local server (default: `localhost:3000`)

---

## 📂 Struktur Project

```
web-download/
│
├── node_modules/
├── public/            # File frontend (HTML, CSS, JS)
├── uploads/           # Hasil download video
├── server.js          # Backend Express
├── package.json
├── package-lock.json
└── export_cookies.py  # Optional cookies export
```

---

## 🚀 Instalasi

### 1. Clone repository

```bash
git clone https://github.com/Luckyfr1945/web-download.git
cd web-download
```

### 2. Install dependencies

```bash
npm install
```

Pastikan sudah install:
- Node.js (v18+ recommended)
- yt-dlp (harus tersedia di system PATH)

Cek:

```bash
yt-dlp --version
```

Kalau belum ada, install dulu sesuai OS kamu.

---

## ▶️ Menjalankan Project

```bash
node server.js
```

Atau jika pakai nodemon:

```bash
npx nodemon server.js
```

Buka browser:

```
http://localhost:3000
```

---

## ⚙️ Konfigurasi

Jika menggunakan cookies (misalnya untuk YouTube login), bisa gunakan:

```bash
python export_cookies.py
```

Lalu sesuaikan path cookies di `server.js`.

---

## ⚠️ Catatan

- Gunakan untuk keperluan pribadi.
- Jangan gunakan untuk melanggar hak cipta.
- Beberapa platform mungkin membatasi akses atau mengubah sistem mereka sewaktu-waktu.

---

## 🛠 Tech Stack

- Node.js
- Express
- yt-dlp
- OpenAI Whisper

---

## 📌 Status

Versi awal (first commit).
Masih dalam pengembangan.
