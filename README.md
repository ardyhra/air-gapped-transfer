# RapidQR

RapidQR is a client-side progressive web app for air-gapped, screen-to-camera file transfer. A sender converts a file into a rateless stream of binary QR fountain symbols. A receiver scans any sufficient set of symbols, solves the original source blocks, verifies the complete file, and offers it for download.

No transfer backend, WebSocket, Bluetooth, Wi-Fi link, or device pairing is used.

## V3 features

- Binary RapidQR Protocol v3 packets (no Base64 transport overhead)
- Sequence and transfer identifiers
- CRC32 validation on every optical frame
- Duplicate rejection and live decoder telemetry
- SHA-256 verification of the reconstructed file
- Systematic LT fountain code followed by an unlimited stream of new recovery equations
- Reliable, Balanced, and Turbo optical profiles
- Unique scan FPS, solve rate, throughput, ETA, pending-equation, and stalled-progress telemetry
- Camera-safe QR payload and error-correction settings per profile
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
4. The receiver completes after its fountain graph solves every source block, then checks SHA-256 before enabling download.

The receiver can join after transmission begins because metadata repeats every 25 displayed frames. The first generation is systematic; subsequent symbols contain deterministic XOR combinations selected by a robust soliton distribution. Every recovery symbol is new, so the receiver never waits for one specific QR to reappear.

## Quality checks

```bash
npm test
npm run lint
npm run build
```

## Deploy to GitHub Pages

The included `.github/workflows/deploy-pages.yml` workflow tests, builds, and deploys the app after every push to `main`. During GitHub Actions builds, Vite automatically derives the correct `/<repository>/` base path from `GITHUB_REPOSITORY`; local development continues to use `/`.

After pushing the project, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**. The deployed URL will be `https://<username>.github.io/<repository>/` unless the repository itself is named `<username>.github.io`.

The protocol tests cover CRC32, SHA-256 fallback, binary packet validation, real QR-to-ZXing byte-mode decoding, legacy Reed–Solomon recovery, deterministic fountain indexes, and end-to-end fountain reconstruction with 35% simulated optical loss.

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

For fountain packets, `group index` carries the monotonically increasing symbol ID and `shard index` records its degree. Sender and receiver independently derive identical source-block indexes from the transfer ID and symbol ID. Metadata carries the filename, MIME type, original size, profile, fountain parameters, and SHA-256 digest.

## Scope and limitations

- V3 is optimized for demonstrable, reliable transfer rather than competing with radio networking. Start with small files and benchmark the actual camera throughput before increasing size.
- LT decoding is probabilistic: solve progress may arrive in bursts, but continued scanning always supplies new equations rather than repeating a fixed carousel.
- Optical reliability depends on display brightness, camera focus, distance, motion blur, and QR density. Lower the sender FPS when scanning is unreliable.
- The application needs network access only for its first load/install. Once cached, transfer and reconstruction are local and networkless.
