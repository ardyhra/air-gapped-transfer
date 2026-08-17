# RapidQR

RapidQR is a client-side progressive web app for air-gapped, screen-to-camera file transfer. A sender converts a file into a repeating sequence of binary QR frames. A receiver scans those frames, rejects damaged or duplicate packets, recovers limited frame loss, verifies the complete file, and offers it for download.

No transfer backend, WebSocket, Bluetooth, Wi-Fi link, or device pairing is used.

## V2 features

- Binary RapidQR Protocol v2 packets (no Base64 transport overhead)
- Sequence and transfer identifiers
- CRC32 validation on every optical frame
- Duplicate rejection and missing-frame visibility
- SHA-256 verification of the reconstructed file
- Reed–Solomon erasure recovery (10 data + 3 recovery frames per full group)
- Interleaved shard scheduling that spreads burst loss across recovery groups
- Camera-safe 360-byte QR payloads with medium QR error correction
- Eight rotating QR mask patterns so repeatedly missed packets change visually
- `requestAnimationFrame` display clock with render-aware adaptive FPS
- Sender preparation in a Web Worker using transferable `ArrayBuffer` objects
- Receiver packet persistence in IndexedDB
- Camera scanning through ZXing plus screenshot import
- Installable PWA with an offline application shell
- Responsive sender and mobile receiver interfaces

## Run locally

```bash
npm install
npm run dev
```

Vite listens on all local interfaces. Open the displayed **Network** URL on another device connected to the same LAN. Allow Node.js through the operating-system firewall if prompted.

For an IPv6-only phone, run `npm run dev:ipv6` and open the laptop's global IPv6 address with square brackets, for example `http://[2404:...]:5173/`. Keep the terminal running while accessing the application.

Camera access normally requires HTTPS or `localhost`. A phone can load the development server over plain HTTP, but most mobile browsers will block camera access because a LAN address is not a secure context. Use an HTTPS deployment or a trusted local HTTPS certificate when testing the receiver camera on a separate phone.

On an insecure HTTP origin, the receiver offers **Capture QR frame** as a limited fallback through the system camera/file picker. This scans one image at a time; continuous high-speed scanning requires HTTPS.

For a real transfer:

1. Open **Send** on the computer, choose a file, and start the QR stream.
2. Open the installed app on the phone and choose **Receive**.
3. Start the camera and keep the entire QR code inside the guide.
4. The receiver completes once every group has enough data or recovery shards, then checks SHA-256 before enabling download.

The receiver can join midway through a cycle because metadata is repeated every 24 data/recovery frames and the complete stream loops indefinitely.

Frames are scheduled by shard round across all Reed–Solomon groups. This prevents a short focus or motion-blur event from wiping out several adjacent shards in one group. Lowering FPS can improve decode reliability, but it also lengthens the time before a missed packet reappears in the next carousel cycle.

The sender rotates through all eight QR mask patterns on successive carousel cycles. A packet that produces a camera-unfriendly pattern therefore gets a different matrix the next time it appears, while its binary protocol payload remains unchanged.

## Quality checks

```bash
npm test
npm run lint
npm run build
```

## Deploy to GitHub Pages

The included `.github/workflows/deploy-pages.yml` workflow tests, builds, and deploys the app after every push to `main`. During GitHub Actions builds, Vite automatically derives the correct `/<repository>/` base path from `GITHUB_REPOSITORY`; local development continues to use `/`.

After pushing the project, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**. The deployed URL will be `https://<username>.github.io/<repository>/` unless the repository itself is named `<username>.github.io`.

The protocol tests cover the standard CRC32 vector, binary packet round-tripping and corruption rejection, a real QR encoder-to-ZXing byte-mode round trip, three-shard Reed–Solomon recovery, and end-to-end reconstruction after dropped data frames.

## Protocol frame

Each QR contains a raw byte-mode packet:

| Field | Size |
| --- | ---: |
| Magic (`RQ`) | 2 bytes |
| Protocol version | 1 byte |
| Packet type | 1 byte |
| Flags | 1 byte |
| Transfer ID | 4 bytes |
| Packet index | 4 bytes |
| Total data chunks | 4 bytes |
| Group index | 4 bytes |
| Shard index | 2 bytes |
| Data shard count | 2 bytes |
| Recovery shard count | 2 bytes |
| Payload length | 2 bytes |
| Payload | variable |
| CRC32 | 4 bytes |

Metadata carries the filename, MIME type, original size, chunk/FEC parameters, and SHA-256 digest. File content stays binary throughout preparation, QR encoding, decoding, and reconstruction.

## Scope and limitations

- V2 is optimized for demonstrable, reliable transfer rather than competing with radio networking. Files up to roughly 25 MB are the practical target.
- Reed–Solomon can recover up to three missing shards in each full group; the carousel supplies additional chances when loss exceeds that threshold.
- Optical reliability depends on display brightness, camera focus, distance, motion blur, and QR density. Lower the sender FPS when scanning is unreliable.
- The application needs network access only for its first load/install. Once cached, transfer and reconstruction are local and networkless.
