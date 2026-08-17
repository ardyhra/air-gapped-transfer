import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode, { QRCodeMaskPattern } from 'qrcode'
import { FileArchive, Gauge, Maximize2, Pause, Play, RotateCcw, ShieldCheck, UploadCloud } from 'lucide-react'
import { PrepareError, PrepareResponse, TransferMetadata } from '../core/types'
import { buildInterleavedSequence } from '../core/schedule'
import { formatBytes, formatDuration, truncateHash } from '../utils/format'

interface SenderProps { onBack: () => void }
type SenderState = 'empty' | 'preparing' | 'ready' | 'playing' | 'paused' | 'error'

export function Sender({ onBack }: SenderProps) {
  const [state, setState] = useState<SenderState>('empty')
  const [file, setFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<TransferMetadata | null>(null)
  const [packets, setPackets] = useState<Uint8Array[]>([])
  const [dataPacketCount, setDataPacketCount] = useState(0)
  const [recoveryPacketCount, setRecoveryPacketCount] = useState(0)
  const [encodedBytes, setEncodedBytes] = useState(0)
  const [targetFps, setTargetFps] = useState(12)
  const [effectiveFps, setEffectiveFps] = useState(12)
  const [frameNumber, setFrameNumber] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [measuredFps, setMeasuredFps] = useState(0)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const animationRef = useRef(0)
  const cursorRef = useRef(0)
  const cycleRef = useRef(0)
  const lastFrameRef = useRef(0)
  const fpsSampleRef = useRef({ startedAt: 0, frames: 0 })

  const displaySequence = useMemo(() => {
    return buildInterleavedSequence(packets)
  }, [packets])

  const renderPacket = useCallback(async (packet: Uint8Array, maskPattern: QRCodeMaskPattern) => {
    if (!canvasRef.current) return
    const startedAt = performance.now()
    await QRCode.toCanvas(canvasRef.current, [{ data: packet, mode: 'byte' }], {
      errorCorrectionLevel: 'M', maskPattern, margin: 4, width: 560,
      color: { dark: '#07110fff', light: '#ffffffff' },
    })
    const renderTime = Math.max(1, performance.now() - startedAt)
    const safeFps = Math.max(5, Math.floor(700 / renderTime))
    setEffectiveFps(Math.min(targetFps, safeFps))
  }, [targetFps])

  useEffect(() => {
    if ((state === 'ready' || state === 'paused') && displaySequence[0]) void renderPacket(displaySequence[0], 0)
  }, [displaySequence, renderPacket, state])

  useEffect(() => {
    if (state !== 'playing' || displaySequence.length === 0) return
    lastFrameRef.current = 0
    fpsSampleRef.current = { startedAt: performance.now(), frames: 0 }
    const loop = (timestamp: number) => {
      const interval = 1000 / effectiveFps
      if (lastFrameRef.current === 0 || timestamp - lastFrameRef.current >= interval) {
        const cursor = cursorRef.current
        const maskPattern = (cycleRef.current % 8) as QRCodeMaskPattern
        void renderPacket(displaySequence[cursor], maskPattern)
        const next = (cursor + 1) % displaySequence.length
        if (next === 0) {
          cycleRef.current += 1
          setCycle(cycleRef.current)
        }
        cursorRef.current = next
        setFrameNumber(next)
        lastFrameRef.current = timestamp - ((timestamp - lastFrameRef.current) % interval)
        const sample = fpsSampleRef.current
        sample.frames += 1
        if (timestamp - sample.startedAt >= 1000) {
          setMeasuredFps((sample.frames * 1000) / (timestamp - sample.startedAt))
          fpsSampleRef.current = { startedAt: timestamp, frames: 0 }
        }
      }
      animationRef.current = requestAnimationFrame(loop)
    }
    animationRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animationRef.current)
  }, [displaySequence, effectiveFps, renderPacket, state])

  const prepareFile = async (selected: File) => {
    setFile(selected)
    setState('preparing')
    setError('')
    try {
      const buffer = await selected.arrayBuffer()
      const worker = new Worker(new URL('../workers/prepare.worker.ts', import.meta.url), { type: 'module' })
      const response = await new Promise<PrepareResponse>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<PrepareResponse | PrepareError>) => {
          if (event.data.ok) resolve(event.data)
          else reject(new Error(event.data.error))
        }
        worker.onerror = () => reject(new Error('The encoding worker stopped unexpectedly.'))
        worker.postMessage({
          buffer, fileName: selected.name, mimeType: selected.type, lastModified: selected.lastModified,
        }, [buffer])
      })
      worker.terminate()
      setMetadata(response.metadata)
      setPackets(response.packets.map((packet) => new Uint8Array(packet)))
      setDataPacketCount(response.dataPacketCount)
      setRecoveryPacketCount(response.recoveryPacketCount)
      setEncodedBytes(response.encodedBytes)
      cursorRef.current = 0
      cycleRef.current = 0
      setFrameNumber(0)
      setCycle(0)
      setState('ready')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare this file.')
      setState('error')
    }
  }

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (selected) void prepareFile(selected)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const selected = event.dataTransfer.files[0]
    if (selected) void prepareFile(selected)
  }
  const reset = () => {
    setState('empty'); setFile(null); setPackets([]); setMetadata(null); setError(''); setCycle(0); cycleRef.current = 0
  }
  const toggleFullscreen = () => canvasRef.current?.closest('.qr-stage')?.requestFullscreen()

  if (state === 'empty' || state === 'preparing' || state === 'error') {
    return (
      <main className="workspace single-panel">
        <button className="back-link" onClick={onBack}>← Back to home</button>
        <section className="workspace-heading">
          <div><span className="step-label">Sender / step 1</span><h1>Choose a file to transmit</h1></div>
          <p>Everything is processed locally. The selected file is never uploaded.</p>
        </section>
        <div className={`drop-zone ${state === 'preparing' ? 'is-loading' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <input ref={inputRef} type="file" hidden onChange={onFileInput} />
          <span className="drop-icon">{state === 'preparing' ? <span className="spinner" /> : <UploadCloud />}</span>
          <h2>{state === 'preparing' ? `Preparing ${file?.name}` : 'Drop any file here'}</h2>
          <p>{state === 'preparing' ? 'Hashing, chunking, and building recovery frames…' : 'or select one from this device'}</p>
          {state !== 'preparing' && <button className="button primary" onClick={() => inputRef.current?.click()}>Browse files</button>}
          {error && <div className="error-banner">{error}</div>}
          <small>Recommended up to 25 MB for practical optical transfer times.</small>
        </div>
      </main>
    )
  }

  const progress = displaySequence.length ? (frameNumber / displaySequence.length) * 100 : 0
  const throughput = effectiveFps * (metadata?.chunkSize ?? 0)
  return (
    <main className="workspace sender-workspace">
      <div className="workspace-topline"><button className="back-link" onClick={reset}>← Choose another file</button><span className="live-badge"><i /> Optical stream ready</span></div>
      <section className="sender-grid">
        <div className="qr-column">
          <div className="qr-stage">
            <canvas ref={canvasRef} aria-label="RapidQR transmission frame" />
            {state === 'paused' && <div className="paused-overlay"><Pause /> Paused</div>}
            <button className="fullscreen-button" onClick={toggleFullscreen} title="Fullscreen"><Maximize2 /></button>
          </div>
          <div className="transport">
            <button className="play-button" onClick={() => setState(state === 'playing' ? 'paused' : 'playing')}>
              {state === 'playing' ? <Pause /> : <Play />}
            </button>
            <div className="transport-main">
              <div className="transport-line"><strong>{state === 'playing' ? 'Transmitting' : state === 'paused' ? 'Transmission paused' : 'Ready to transmit'}</strong><span>Cycle {cycle + 1}</span></div>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <div className="transport-line sub"><span>Frame {Math.min(frameNumber + 1, displaySequence.length)} / {displaySequence.length}</span><span>{measuredFps.toFixed(1)} measured FPS</span></div>
            </div>
          </div>
        </div>

        <aside className="control-panel">
          <div className="file-summary"><span className="file-icon"><FileArchive /></span><div><strong>{file?.name}</strong><span>{formatBytes(file?.size ?? 0)} · {file?.type || 'Binary file'}</span></div><button onClick={reset}><RotateCcw /></button></div>
          <div className="control-section">
            <div className="section-title"><span><Gauge /> Transmission speed</span><strong>{targetFps} FPS</strong></div>
            <input className="range" type="range" min="5" max="24" value={targetFps} onChange={(event) => setTargetFps(Number(event.target.value))} />
            <div className="range-labels"><span>Reliable</span><span>Balanced</span><span>Turbo</span></div>
            <p className="adaptive-note"><i /> Adaptive clock active · output {effectiveFps} FPS</p>
          </div>
          <div className="stat-grid">
            <div><span>Data frames</span><strong>{dataPacketCount.toLocaleString()}</strong></div>
            <div><span>Recovery frames</span><strong>{recoveryPacketCount.toLocaleString()}</strong></div>
            <div><span>Est. rate</span><strong>{formatBytes(throughput)}/s</strong></div>
            <div><span>Est. cycle</span><strong>{formatDuration(displaySequence.length / effectiveFps)}</strong></div>
          </div>
          <div className="integrity-card"><ShieldCheck /><div><span>SHA-256 integrity</span><code>{truncateHash(metadata?.sha256 ?? '')}</code></div><b>Verified</b></div>
          <dl className="protocol-details">
            <div><dt>Protocol</dt><dd>RQR / 2</dd></div>
            <div><dt>Packet payload</dt><dd>{metadata?.chunkSize} bytes</dd></div>
            <div><dt>Error recovery</dt><dd>{metadata?.dataShards}+{metadata?.parityShards} Reed–Solomon</dd></div>
            <div><dt>Encoded stream</dt><dd>{formatBytes(encodedBytes)}</dd></div>
          </dl>
          <p className="sender-tip">Camera-safe QR density and a rotating mask give every missed packet a different visual pattern on the next cycle. Keep the full white border visible.</p>
        </aside>
      </section>
    </main>
  )
}
