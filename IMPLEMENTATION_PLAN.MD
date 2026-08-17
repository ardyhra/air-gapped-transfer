Ya, relevan—dan justru cukup menarik untuk portfolio karena berbeda dari proyek AI yang umum. Ide ini menunjukkan **software engineering, networking/protocol design, computer vision ringan, encoding, error correction, dan optimasi performa** dalam satu proyek.

Konsepnya secara teknis masuk akal:

**File → chunking → encoding → QR frames → kamera HP → decode → reassembly → file asli**

Misalnya file 2 MB dibagi menjadi ribuan potongan kecil. Setiap QR membawa payload seperti:

```text
File ID
Frame index
Total frames
Payload
Checksum
```

Lalu layar laptop menampilkan QR secara berurutan dengan cepat, misalnya 10–30 frame per detik. HP membaca frame-frame tersebut dan menyusun kembali file setelah cukup data diterima.

Yang membuat proyek ini bagus bukan sekadar "transfer file pakai QR", tetapi tantangan engineering-nya.

### Bagian yang paling menarik

Pertama, Anda perlu menghadapi **frame loss**. Kamera HP hampir pasti tidak akan membaca 100% QR yang ditampilkan. Kalau frame #812 terlewat, sistem tidak boleh langsung gagal.

Solusi sederhana:

```text
Frame 811 ✓
Frame 812 ✗
Frame 813 ✓
```

HP mencatat frame yang hilang, lalu sender dapat mengulanginya. Tetapi versi yang lebih menarik adalah memakai **Forward Error Correction**, misalnya Reed–Solomon atau fountain codes.

Dengan fountain code, receiver bahkan tidak harus menerima frame tertentu. Selama mendapatkan cukup encoded blocks, file dapat direkonstruksi. Ini membuat proyek jauh lebih impressive secara teknis.

Kedua, Anda bisa melakukan eksperimen terhadap **QR density vs FPS vs reliability**. QR yang terlalu padat membawa lebih banyak byte per frame, tetapi lebih sulit dibaca. QR yang terlalu sederhana lebih mudah dibaca, tetapi throughput turun.

Anda bisa menghasilkan benchmark seperti:

| Mode     | QR FPS | Payload/frame | Transfer rate | Success |
| -------- | -----: | ------------: | ------------: | ------: |
| Reliable |      8 |         800 B |      6.4 KB/s |   99.8% |
| Balanced |     15 |        1.2 KB |       18 KB/s |   98.5% |
| Turbo    |     30 |        1.5 KB |       45 KB/s |   91.2% |

Itu sudah terlihat seperti proyek engineering yang serius.

### Bahkan ada twist yang lebih menarik

Jangan batasi konsepnya menjadi **QR tunggal yang berganti-ganti**.

Anda dapat membuat:

> **Optical File Transfer Protocol**

dan QR hanyalah salah satu encoding visual.

Misalnya layar laptop menampilkan grid:

```text
┌─────┬─────┬─────┬─────┐
│ QR1 │ QR2 │ QR3 │ QR4 │
├─────┼─────┼─────┼─────┤
│ QR5 │ QR6 │ QR7 │ QR8 │
└─────┴─────┴─────┴─────┘
```

Kamera HP membaca beberapa QR sekaligus per frame. Secara teoritis throughput bisa meningkat drastis jika resolusi kamera dan layar memadai.

Versi lebih ekstrem lagi adalah membuat encoding visual sendiri berupa **colored blocks**, mirip komunikasi optik antara layar dan kamera.

```text
█ ▓ ░ █ ▓
▓ █ █ ░ ▓
░ ▓ █ █ █
```

Warna atau pola tertentu merepresentasikan bit. Kemudian kamera mendeteksi grid, melakukan perspective correction, membaca simbol, lalu melakukan error correction.

Nah, pada titik itu proyek Anda sudah berubah dari aplikasi QR sederhana menjadi semacam:

> **Screen-to-Camera Optical Data Transmission System**

Ini sangat cocok untuk portfolio Informatika karena menunjukkan bahwa Anda mampu merancang **protokol komunikasi dari bawah**, bukan sekadar memakai library.

### Architecture yang bisa Anda buat

```text
                 SENDER — PC
                      │
                     File
                      │
                Compression
                      │
                  Chunking
                      │
             Error Correction
                      │
                Frame Encoder
                      │
              QR / Visual Code
                      │
                   Display
                      │
                      ▼
                Optical Channel
                      │
                      ▼
                 Phone Camera
                      │
               Frame Detection
                      │
                 QR Decoder
                      │
              Error Correction
                      │
                 Reassembly
                      │
                      ▼
                    File
```

Di sisi HP, computer vision juga mulai masuk. Anda dapat melakukan:

* QR localization
* perspective correction
* motion blur detection
* exposure adjustment
* multi-code detection
* dropped-frame handling
* duplicate-frame rejection

Jadi masih cukup relevan dengan profil Anda yang banyak bergerak di Computer Vision.

### Ada satu kelemahan besar: bandwidth

Ini bukan metode terbaik untuk mentransfer file besar.

QR melalui kamera kemungkinan jauh lebih lambat dibanding Wi-Fi Direct, Bluetooth, LocalSend, AirDrop, atau bahkan upload internet. Karena itu jangan memasarkan proyek sebagai:

> "A faster alternative to Wi-Fi file transfer."

Lebih tepat:

> **Offline optical file transfer without pairing, networking, Bluetooth, or physical connection.**

Use case-nya justru menjadi menarik ketika dua perangkat **tidak boleh atau tidak bisa membangun koneksi jaringan**.

Contohnya:

```text
PC ─X─ Internet
PC ─X─ Wi-Fi
PC ─X─ Bluetooth
PC ─X─ USB

PC screen
   ↓ photons
Phone camera
```

Dengan kata lain, **air-gapped data transfer**.

Ini juga memberi cerita bagus untuk portfolio:

> "Can a computer transmit arbitrary files to a smartphone using nothing but its display and the phone's camera?"

Itu jauh lebih memorable daripada proyek seperti "Todo App" atau "Image Classifier".

### Fitur yang saya jadikan roadmap

Versi MVP cukup:

```text
File
↓
Base64/binary encoding
↓
split into chunks
↓
QR sequence
↓
camera scan
↓
reassemble
```

Kemudian V2:

* sequence number
* checksum/CRC
* duplicate detection
* missing-frame detection
* adaptive FPS

V3:

* Reed–Solomon/Fountain codes
* compression
* encryption
* multi-QR per screen
* automatic bitrate adaptation

V4:

* custom visual encoding
* benchmark terhadap QR
* automatic screen detection
* perspective correction
* real-time transfer statistics

Misalnya UI receiver:

```text
Receiving cat.png

██████████████████░░  87%

3.2 MB / 3.7 MB
Frames received : 2,817
Frames lost     : 37
Recovered by FEC: 34

Throughput       : 42.7 KB/s
ETA              : 11 s
```

Itu sudah terlihat sangat polished.

Menurut saya proyek ini malah **layak masuk 5–6 proyek utama portfolio Anda** karena portfolio Anda sudah punya proyek AI/CV yang kuat dari ANPR. Proyek Rapid QR ini menambah sisi **algorithms + systems + protocol engineering + mobile development**, sehingga menunjukkan range kemampuan yang lebih luas daripada menambah satu proyek YOLO lagi.



Untuk versi **web**, saya akan membuatnya sebagai **client-side PWA** tanpa backend transfer file. Jadi setelah halaman dimuat, file tidak pernah dikirim ke server; laptop mengubah file menjadi stream QR, sementara HP membaca kamera dan merekonstruksi file secara lokal. Ini paling sesuai dengan konsep *air-gapped transfer*.

### Stack yang saya rekomendasikan

| Bagian                | Pilihan                                      | Alasan                                                     |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Frontend              | **React + TypeScript + Vite**                | UI interaktif, state transfer kompleks, mudah dikembangkan |
| Styling               | **Tailwind CSS**                             | Cepat membuat UI portfolio yang polished                   |
| QR generator          | **qrcode / QRCode.js**                       | Generate QR ke Canvas/SVG                                  |
| QR scanner            | **@zxing/browser**                           | Kamera + decoding QR langsung di browser                   |
| File handling         | **ArrayBuffer / Uint8Array / Blob**          | Binary-native, jangan Base64                               |
| Background processing | **Web Workers**                              | Encoding/decoding tidak membuat UI macet                   |
| Integrity             | **CRC32 + SHA-256 Web Crypto API**           | cek frame dan file akhir                                   |
| Compression           | **CompressionStream** atau WASM codec        | opsional                                                   |
| Error correction      | **Reed-Solomon / Fountain Code**             | menangani QR yang terlewat                                 |
| Storage receiver      | **IndexedDB**                                | menampung chunk tanpa memenuhi RAM                         |
| Offline app           | **PWA + Service Worker**                     | sender/receiver dapat berjalan tanpa internet              |
| Deployment            | **GitHub Pages / Cloudflare Pages / Vercel** | hanya untuk mengunduh aplikasi awal                        |

Vite sendiri mendukung TypeScript, Workers, dan WebAssembly, sehingga cocok untuk proyek seperti ini. ([vitejs][1])

Saya **tidak menyarankan Next.js** untuk versi pertama. Anda hampir tidak membutuhkan SSR, API routes, database server, atau authentication. React + Vite lebih sederhana dan konsep arsitekturnya lebih bersih.

---

## Arsitektur aplikasi

Saya akan membuat **satu web app**, tetapi mempunyai dua mode:

```text
RapidQR
│
├── Send
│   └── PC / Laptop
│
└── Receive
    └── Smartphone
```

Flow sender:

```text
FILE
  ↓
File.arrayBuffer()
  ↓
Uint8Array
  ↓
Compression (optional)
  ↓
Chunking
  ↓
FEC Encoder
  ↓
Frame Packets
  ↓
QR Encoder
  ↓
Canvas
  ↓
60 Hz Display Loop
```

Receiver:

```text
Camera
  ↓
Video Stream
  ↓
Frame Capture
  ↓
QR Decoder
  ↓
Packet Parser
  ↓
CRC Validation
  ↓
FEC Decoder
  ↓
Chunk Reassembly
  ↓
SHA-256 Validation
  ↓
Blob
  ↓
Download file
```

---

# 1. React + TypeScript + Vite

Untuk proyek portfolio Anda, saya pilih:

```text
React
TypeScript
Vite
```

daripada vanilla JavaScript.

Alasannya transfer mempunyai banyak state:

```ts
idle
preparing
transmitting
receiving
recovering
verifying
completed
failed
```

Belum lagi statistik:

```ts
totalFrames
receivedFrames
uniqueFrames
corruptFrames
recoveredFrames
currentFPS
bitrate
progress
```

React membuat UI seperti ini jauh lebih mudah dikelola.

TypeScript juga sangat berguna karena kita dapat mendefinisikan packet:

```ts
interface TransferPacket {
  protocolVersion: number;
  transferId: number;
  frameId: number;
  totalBlocks: number;
  payload: Uint8Array;
  checksum: number;
}
```

Ini proyek yang bagus untuk menunjukkan bahwa Anda tidak hanya bisa Python/AI, tetapi juga **software engineering yang strongly typed**.

---

# 2. Jangan gunakan Base64

Ini cukup penting.

Implementasi paling gampang memang:

```text
File
↓
Base64
↓
split string
↓
QR
```

tetapi saya tidak akan menggunakan itu kecuali untuk prototype pertama sekali.

Base64 menambah ukuran data sekitar **33%**.

Lebih baik:

```text
File
↓
ArrayBuffer
↓
Uint8Array
↓
binary QR payload
```

Browser memang menyediakan `ArrayBuffer` sebagai representasi binary, dan buffer juga bisa ditransfer ke Web Worker tanpa harus melakukan copy penuh. ([MDN Web Docs][2])

---

# 3. Web Worker sangat penting

Misalnya file:

```text
50 MB
```

kemudian browser harus:

* calculate hash
* compress
* chunk
* generate redundancy
* encode
* decode QR frames

Jika semuanya berada pada React/main thread:

```text
Encoding...
      ↓
browser freeze
      ↓
QR animation stutter
```

Padahal untuk sistem Anda, **QR frame timing harus stabil**.

Jadi:

```text
MAIN THREAD
│
├── React UI
├── animation
└── QR renderer

WEB WORKER
│
├── chunking
├── hashing
├── FEC
├── packet generation
└── reassembly
```

`ArrayBuffer` dapat diberikan kepada Worker sebagai **transferable object**, sehingga ownership datanya berpindah tanpa cloning buffer besar. ([MDN Web Docs][2])

Ini juga menjadi poin engineering yang sangat bagus untuk dijelaskan di portfolio.

---

# 4. QR decoding: ZXing

Untuk receiver, saya akan memakai:

**`@zxing/browser`**

karena library tersebut memang menyediakan decoding barcode/QR dari kamera browser. Dokumentasinya menyediakan skenario QR scanning dari video camera. ([GitHub][3])

Browser sebenarnya mempunyai:

```js
BarcodeDetector
```

yang bisa mendeteksi QR secara native. ([MDN Web Docs][4])

Tetapi saya **tidak akan menjadikannya decoder utama**, karena API tersebut masih ditandai experimental dan dukungan platform tidak universal. ([MDN Web Docs][4])

Arsitektur yang lebih bagus:

```text
if BarcodeDetector supported:
    native decoder
else:
    ZXing fallback
```

Ini bisa menjadi optimasi V2.

---

# 5. QR Generator

Di sender Anda sebenarnya tidak memerlukan library yang terlalu kompleks.

Cukup QR generator yang dapat menghasilkan:

```text
Uint8Array
    ↓
QR matrix
    ↓
Canvas
```

Saya lebih memilih render ke **Canvas** daripada membuat `<img>` berulang kali.

Jangan:

```text
Generate PNG
↓
create <img>
↓
display
↓
destroy
↓
generate PNG
...
```

Lebih baik:

```text
packet
 ↓
QR matrix
 ↓
draw Canvas
 ↓
next packet
 ↓
draw Canvas
```

Karena Anda mungkin akan mengejar:

```text
10 FPS
20 FPS
30 FPS
...
```

---

# 6. Jangan pakai `setInterval()` sebagai clock utama

Untuk menampilkan QR dengan cepat, saya akan mendesain semacam:

```js
requestAnimationFrame(renderLoop);
```

dan menentukan kapan frame QR berikutnya harus ditampilkan berdasarkan timestamp.

Contohnya target:

```text
Display refresh = 60 Hz
QR target       = 15 FPS

screen:
QR1 QR1 QR1 QR1
QR2 QR2 QR2 QR2
QR3 QR3 QR3 QR3
```

Jadi setiap QR bertahan sekitar empat refresh frame.

Kemudian tersedia slider:

```text
Transmission Speed

5 FPS   ─────●──────── 30 FPS
             15 FPS
```

---

# 7. Protocol Anda sendiri

Bagian ini menurut saya justru harus menjadi **inti portfolio**.

Jangan hanya:

```text
QR library → QR library
```

Buat format packet sendiri, misalnya:

```text
┌──────────────────────────────┐
│ MAGIC          2 bytes       │
│ VERSION        1 byte        │
│ FLAGS          1 byte        │
│ TRANSFER_ID    4 bytes       │
│ BLOCK_ID       4 bytes       │
│ PAYLOAD_SIZE   2 bytes       │
│ PAYLOAD        N bytes       │
│ CRC32          4 bytes       │
└──────────────────────────────┘
```

Misalnya magic:

```text
RQ
```

atau

```text
RQR
```

Receiver bisa mengetahui:

> ini bukan QR biasa, tetapi RapidQR protocol.

Metadata awal bisa mempunyai:

```text
filename
mimeType
fileSize
chunkSize
SHA256
compression
FEC parameters
```

---

# 8. CRC32 + SHA-256

Gunakan keduanya untuk fungsi berbeda.

### CRC setiap packet

```text
Frame #183
payload
CRC32
```

Jika hasil kamera salah decode:

```text
CRC mismatch → discard frame
```

### SHA-256 untuk file keseluruhan

Sender:

```text
SHA256(file) =
8be3...91af
```

Receiver setelah reconstruction:

```text
SHA256(received file) =
8be3...91af

✓ File integrity verified
```

SHA-256 tersedia melalui browser **Web Crypto API**, jadi tidak perlu backend.

---

# 9. Tantangan paling penting: dropped frames

Misalnya sender:

```text
1 2 3 4 5 6 7 8 9
```

kamera membaca:

```text
1 2 3 _ 5 6 _ 8 9
```

Solusi paling sederhana:

```text
sequence number
+
repeat transmission
```

Tetapi akan sangat tidak efisien.

Saya justru membuat roadmap:

### MVP — Carousel

```text
1 2 3 4 5
1 2 3 4 5
1 2 3 4 5
```

Receiver mengabaikan duplicate.

### V2 — Reed-Solomon

Contohnya:

```text
10 data chunks
+
3 recovery chunks
```

Beberapa chunk hilang masih bisa direkonstruksi.

### V3 — Fountain code

Ini sangat cocok dengan transmission satu arah.

Daripada receiver membutuhkan:

```text
frame 1
frame 2
frame 3
...
frame 1000
```

sender terus menghasilkan encoded symbols:

```text
E1
E2
E3
E4
...
```

Receiver cukup mengumpulkan kira-kira:

```text
~1000+ symbols
```

lalu reconstruction bisa selesai.

Ini menghilangkan kebutuhan feedback channel yang rumit.

---

# 10. IndexedDB untuk receiver

Jangan simpan file besar seperti ini:

```ts
const receivedChunks = []
```

selamanya di RAM.

Untuk file cukup besar, gunakan:

```text
QR
 ↓
decoded chunk
 ↓
IndexedDB
```

Kemudian setelah selesai:

```text
IndexedDB chunks
↓
reconstruct
↓
Blob
↓
download
```

Ini memungkinkan aplikasi menangani transfer jauh lebih besar.

---

# 11. PWA penting untuk konsep air-gapped

Ada sedikit paradoks:

> Kalau aplikasi web membutuhkan internet untuk membuka websitenya, apakah benar-benar air-gapped?

Solusinya adalah **Progressive Web App**.

Pertama kali:

```text
Internet available

rapidqr.app
     ↓
Install PWA
```

Setelah asset di-cache:

```text
NO INTERNET

Laptop                 Phone
RapidQR PWA             RapidQR PWA
    │                       │
    │ QR QR QR QR QR        │
    └──────────────────────► 📷
```

Tidak ada request jaringan selama transfer.

Jadi klaim yang tepat:

> **Networkless data transfer after application installation.**

Bukan bahwa web app tidak pernah membutuhkan internet sama sekali.

---

# Stack keseluruhan yang saya pilih

```text
RapidQR
│
├── Frontend
│   ├── React
│   ├── TypeScript
│   ├── Vite
│   └── Tailwind CSS
│
├── File Engine
│   ├── File API
│   ├── Blob
│   ├── ArrayBuffer
│   └── Uint8Array
│
├── Transfer Engine
│   ├── Custom RapidQR Protocol
│   ├── Chunking
│   ├── CRC32
│   ├── SHA-256
│   └── Reed-Solomon / Fountain Code
│
├── Optical Layer
│   ├── QR encoder
│   ├── Canvas
│   └── ZXing Browser
│
├── Performance
│   ├── Web Workers
│   ├── Transferable ArrayBuffer
│   └── requestAnimationFrame
│
├── Storage
│   └── IndexedDB
│
└── Offline
    ├── PWA
    └── Service Worker
```

## Yang justru tidak saya masukkan

Untuk V1 saya **tidak akan memakai**:

```text
❌ Node/Express backend
❌ Python/FastAPI server
❌ PostgreSQL
❌ Firebase
❌ WebSocket
❌ WebRTC
```

Karena komponen-komponen itu justru mengaburkan hal unik dari proyeknya.

Laptop dan HP **tidak berkomunikasi melalui jaringan sama sekali**:

```text
Laptop RAM
     │
     ▼
Laptop Display
     │
  photons
     │
     ▼
Phone Camera
     │
     ▼
Phone RAM/storage
```

Itulah yang membuatnya menarik.

Dan saya akan memberi nama proyek yang sedikit lebih serius daripada sekadar **QR File Transfer**, misalnya **RapidQR — Air-Gapped Optical File Transfer**. Untuk portfolio Anda, proyek ini bisa menjadi salah satu showcase terbaik di luar AI: ANPR menunjukkan kemampuan AI/CV Anda, sedangkan RapidQR menunjukkan bahwa Anda mampu merancang **protocol, binary data processing, concurrency, error recovery, browser APIs, dan performance-sensitive software**.

[1]: https://vite.dev/?utm_source=chatgpt.com "Vite | Next Generation Frontend Tooling"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects?utm_source=chatgpt.com "Transferable objects - Web APIs | MDN"
[3]: https://github.com/zxing-js/browser?utm_source=chatgpt.com "zxing-js/browser - GitHub"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector?utm_source=chatgpt.com "BarcodeDetector - Web APIs - MDN Web Docs"

