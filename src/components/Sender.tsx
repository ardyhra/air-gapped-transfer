import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode, { QRCodeMaskPattern } from 'qrcode'
import { FileArchive, Gauge, Maximize2, Pause, Play, RotateCcw, ShieldCheck, UploadCloud } from 'lucide-react'
import { createFountainPacket } from '../core/fountain'
import { getProfile, TRANSMISSION_PROFILES, TransmissionProfile } from '../core/profiles'
import { PrepareError, PrepareResponse, TransferMetadata } from '../core/types'
import { formatBytes, formatDuration, truncateHash } from '../utils/format'

interface SenderProps { onBack: () => void }
type SenderState = 'empty' | 'preparing' | 'ready' | 'playing' | 'paused' | 'error'

export function Sender({ onBack }: SenderProps) {
  const [state, setState] = useState<SenderState>('empty')
  const [file, setFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<TransferMetadata | null>(null)
  const [metadataPacket, setMetadataPacket] = useState<Uint8Array | null>(null)
  const [sourceBlocks, setSourceBlocks] = useState<Uint8Array[]>([])
  const [encodedBytes, setEncodedBytes] = useState(0)
  const [profileId, setProfileId] = useState<TransmissionProfile['id']>('balanced')
  const profile = useMemo(() => getProfile(profileId), [profileId])
  const [targetFps, setTargetFps] = useState(profile.defaultFps)
  const [effectiveFps, setEffectiveFps] = useState(profile.defaultFps)
  const [symbolCount, setSymbolCount] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [measuredFps, setMeasuredFps] = useState(0)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const animationRef = useRef(0)
  const symbolIdRef = useRef(0)
  const displayedFramesRef = useRef(0)
  const generationRef = useRef(0)
  const lastFrameRef = useRef(0)
  const fpsSampleRef = useRef({ startedAt: 0, frames: 0 })

  const renderPacket = useCallback(async (packet: Uint8Array, maskPattern: QRCodeMaskPattern) => {
    if (!canvasRef.current) return
    const startedAt = performance.now()
    await QRCode.toCanvas(canvasRef.current, [{ data: packet, mode: 'byte' }], {
      errorCorrectionLevel: profile.errorCorrectionLevel,
      maskPattern,
      margin: 4,
      width: 560,
      color: { dark: '#07110fff', light: '#ffffffff' },
    })
    const renderTime = Math.max(1, performance.now() - startedAt)
    const safeFps = Math.max(3, Math.floor(700 / renderTime))
    setEffectiveFps(Math.min(targetFps, safeFps))
  }, [profile.errorCorrectionLevel, targetFps])

  useEffect(() => {
    if ((state === 'ready' || state === 'paused') && metadataPacket) void renderPacket(metadataPacket, 0)
  }, [metadataPacket, renderPacket, state])

  useEffect(() => {
    if (state !== 'playing' || !metadataPacket || !metadata || sourceBlocks.length === 0) return
    lastFrameRef.current = 0
    fpsSampleRef.current = { startedAt: performance.now(), frames: 0 }
    const loop = (timestamp: number) => {
      const interval = 1000 / effectiveFps
      if (lastFrameRef.current === 0 || timestamp - lastFrameRef.current >= interval) {
        const maskPattern = (generationRef.current % 8) as QRCodeMaskPattern
        const isMetadataFrame = displayedFramesRef.current % 25 === 0
        const packet = isMetadataFrame
          ? metadataPacket
          : createFountainPacket(metadata, sourceBlocks, symbolIdRef.current)
        void renderPacket(packet, maskPattern)
        displayedFramesRef.current += 1
        if (!isMetadataFrame) {
          symbolIdRef.current += 1
          setSymbolCount(symbolIdRef.current)
          const nextGeneration = Math.floor(symbolIdRef.current / metadata.totalDataChunks)
          if (nextGeneration !== generationRef.current) {
            generationRef.current = nextGeneration
            setGeneration(nextGeneration)
          }
        }
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
  }, [effectiveFps, metadata, metadataPacket, renderPacket, sourceBlocks, state])

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
        worker.postMessage({ buffer, fileName: selected.name, mimeType: selected.type, lastModified: selected.lastModified, profileId }, [buffer])
      })
      worker.terminate()
      setMetadata(response.metadata)
      setMetadataPacket(new Uint8Array(response.metadataPacket))
      setSourceBlocks(response.sourceBlocks.map((block) => new Uint8Array(block)))
      setEncodedBytes(response.encodedBytes)
      symbolIdRef.current = 0; displayedFramesRef.current = 0; generationRef.current = 0
      setSymbolCount(0); setGeneration(0); setState('ready')
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
  const selectProfile = (selected: TransmissionProfile) => {
    setProfileId(selected.id); setTargetFps(selected.defaultFps); setEffectiveFps(selected.defaultFps)
  }
  const reset = () => {
    setState('empty'); setFile(null); setMetadataPacket(null); setSourceBlocks([]); setMetadata(null); setError('')
    setSymbolCount(0); setGeneration(0); symbolIdRef.current = 0; displayedFramesRef.current = 0; generationRef.current = 0
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
        <div className="profile-picker" aria-label="Transmission profile">
          {TRANSMISSION_PROFILES.map((option) => (
            <button key={option.id} className={profileId === option.id ? 'active' : ''} disabled={state === 'preparing'} onClick={() => selectProfile(option)}>
              <strong>{option.name}</strong><span>{option.chunkSize} B · {option.defaultFps} FPS</span><small>{option.description}</small>
            </button>
          ))}
        </div>
        <div className={`drop-zone ${state === 'preparing' ? 'is-loading' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <input ref={inputRef} type="file" hidden onChange={onFileInput} />
          <span className="drop-icon">{state === 'preparing' ? <span className="spinner" /> : <UploadCloud />}</span>
          <h2>{state === 'preparing' ? `Preparing ${file?.name}` : 'Drop any file here'}</h2>
          <p>{state === 'preparing' ? 'Hashing and preparing fountain source blocks…' : `or select one from this device · ${profile.name} profile`}</p>
          {state !== 'preparing' && <button className="button primary" onClick={() => inputRef.current?.click()}>Browse files</button>}
          {error && <div className="error-banner">{error}</div>}
          <small>Start with Balanced; use Reliable when focus or lighting is difficult.</small>
        </div>
      </main>
    )
  }

  const progress = metadata ? ((symbolCount % metadata.totalDataChunks) / metadata.totalDataChunks) * 100 : 0
  const throughput = effectiveFps * (metadata?.chunkSize ?? 0)
  const firstPassSeconds = metadata ? metadata.totalDataChunks / (effectiveFps * 24 / 25) : 0
  return (
    <main className="workspace sender-workspace">
      <div className="workspace-topline"><button className="back-link" onClick={reset}>← Choose another file</button><span className="live-badge"><i /> Rateless stream ready</span></div>
      <section className="sender-grid">
        <div className="qr-column">
          <div className="qr-stage">
            <canvas ref={canvasRef} aria-label="RapidQR fountain symbol" />
            {state === 'paused' && <div className="paused-overlay"><Pause /> Paused</div>}
            <button className="fullscreen-button" onClick={toggleFullscreen} title="Fullscreen"><Maximize2 /></button>
          </div>
          <div className="transport">
            <button className="play-button" onClick={() => setState(state === 'playing' ? 'paused' : 'playing')}>{state === 'playing' ? <Pause /> : <Play />}</button>
            <div className="transport-main">
              <div className="transport-line"><strong>{state === 'playing' ? 'Streaming rateless symbols' : state === 'paused' ? 'Transmission paused' : 'Ready to transmit'}</strong><span>Generation {generation + 1}</span></div>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <div className="transport-line sub"><span>Symbol {symbolCount.toLocaleString()} · never repeats</span><span>{measuredFps.toFixed(1)} measured FPS</span></div>
            </div>
          </div>
        </div>

        <aside className="control-panel">
          <div className="file-summary"><span className="file-icon"><FileArchive /></span><div><strong>{file?.name}</strong><span>{formatBytes(file?.size ?? 0)} · {profile.name} profile</span></div><button onClick={reset}><RotateCcw /></button></div>
          <div className="control-section">
            <div className="section-title"><span><Gauge /> Transmission speed</span><strong>{targetFps} FPS</strong></div>
            <input className="range" type="range" min="3" max={profile.maxFps} value={targetFps} onChange={(event) => setTargetFps(Number(event.target.value))} />
            <div className="range-labels"><span>Stable</span><span>{profile.name}</span><span>Max</span></div>
            <p className="adaptive-note"><i /> Adaptive clock active · output {effectiveFps} FPS</p>
          </div>
          <div className="stat-grid">
            <div><span>Source blocks</span><strong>{metadata?.totalDataChunks.toLocaleString()}</strong></div>
            <div><span>Symbols sent</span><strong>{symbolCount.toLocaleString()}</strong></div>
            <div><span>Est. optical rate</span><strong>{formatBytes(throughput)}/s</strong></div>
            <div><span>First pass</span><strong>{formatDuration(firstPassSeconds)}</strong></div>
          </div>
          <div className="integrity-card"><ShieldCheck /><div><span>SHA-256 integrity</span><code>{truncateHash(metadata?.sha256 ?? '')}</code></div><b>Ready</b></div>
          <dl className="protocol-details">
            <div><dt>Protocol</dt><dd>RQR / 3</dd></div>
            <div><dt>Symbol payload</dt><dd>{metadata?.chunkSize} bytes</dd></div>
            <div><dt>Error recovery</dt><dd>Rateless LT fountain</dd></div>
            <div><dt>Source buffer</dt><dd>{formatBytes(encodedBytes)}</dd></div>
          </dl>
          <p className="sender-tip">After the systematic pass every QR is a new recovery equation. There is no carousel and no permanently missing frame.</p>
        </aside>
      </section>
    </main>
  )
}
