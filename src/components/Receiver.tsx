import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser'
import { Camera, Check, Download, FileCheck2, ImagePlus, RefreshCw, ScanLine, ShieldCheck } from 'lucide-react'
import { FountainDecoder } from '../core/fountain'
import { sha256 } from '../core/hash'
import { decodePacket, PacketError } from '../core/packet'
import { clearTransfer, persistPacket } from '../core/packetStore'
import { extractByteModePayload } from '../core/qrTransport'
import { readMetadata } from '../core/transfer'
import { Packet, PacketType, TransferMetadata } from '../core/types'
import { formatBytes, formatDuration, truncateHash } from '../utils/format'

interface ReceiverProps { onBack: () => void }
type ReceiverState = 'idle' | 'scanning' | 'receiving' | 'verifying' | 'complete' | 'error'

interface ScanStats {
  unique: number
  duplicates: number
  corrupt: number
  symbols: number
  solved: number
  pendingEquations: number
}

const initialStats: ScanStats = { unique: 0, duplicates: 0, corrupt: 0, symbols: 0, solved: 0, pendingEquations: 0 }

export function Receiver({ onBack }: ReceiverProps) {
  const [state, setState] = useState<ReceiverState>('idle')
  const [metadata, setMetadata] = useState<TransferMetadata | null>(null)
  const [stats, setStats] = useState(initialStats)
  const [message, setMessage] = useState('Camera is ready when you are.')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [recoveredChunks, setRecoveredChunks] = useState(0)
  const [verifiedHash, setVerifiedHash] = useState('')
  const [telemetryClock, setTelemetryClock] = useState(Date.now())
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const readerRef = useRef(new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 35, delayBetweenScanSuccess: 0 }))
  const seenPacketsRef = useRef(new Set<number>())
  const pendingSymbolsRef = useRef<Packet[]>([])
  const transferIdRef = useRef<number | null>(null)
  const metadataRef = useRef<TransferMetadata | null>(null)
  const decoderRef = useRef<FountainDecoder | null>(null)
  const finalizingRef = useRef(false)
  const startedAtRef = useRef(0)
  const lastProgressAtRef = useRef(0)
  const uniqueTimestampsRef = useRef<number[]>([])
  const systematicSymbolsRef = useRef(new Set<number>())

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setTelemetryClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    stopCamera()
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  }, [downloadUrl, stopCamera])

  const finalize = useCallback(async (currentMetadata: TransferMetadata) => {
    const decoder = decoderRef.current
    if (finalizingRef.current || !decoder?.complete) return
    finalizingRef.current = true
    setState('verifying')
    setMessage('Assembling source blocks and checking SHA-256…')
    try {
      const bytes = decoder.assemble(currentMetadata.fileSize)
      const digest = await sha256(bytes)
      if (digest !== currentMetadata.sha256) throw new Error('Final SHA-256 does not match the sender.')
      const blob = new Blob([bytes], { type: currentMetadata.mimeType })
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      setRecoveredChunks(currentMetadata.totalDataChunks - systematicSymbolsRef.current.size)
      setVerifiedHash(digest)
      setState('complete')
      setMessage('File recovered and cryptographically verified.')
      stopCamera()
    } catch (error) {
      finalizingRef.current = false
      setState('error')
      setMessage(error instanceof Error ? error.message : 'File verification failed.')
    }
  }, [stopCamera])

  const updateDecoderStats = useCallback((decoder: FountainDecoder, currentMetadata: TransferMetadata) => {
    setStats((current) => ({
      ...current,
      unique: seenPacketsRef.current.size,
      solved: decoder.solvedBlocks,
      pendingEquations: decoder.pendingEquations,
    }))
    if (decoder.complete) void finalize(currentMetadata)
  }, [finalize])

  const feedSymbol = useCallback((packet: Packet, currentMetadata: TransferMetadata) => {
    const decoder = decoderRef.current
    if (!decoder || packet.type !== PacketType.Fountain) return
    const solvedBefore = decoder.solvedBlocks
    decoder.addSymbol(packet.groupIndex, packet.payload)
    if (packet.groupIndex < currentMetadata.totalDataChunks) systematicSymbolsRef.current.add(packet.groupIndex)
    if (decoder.solvedBlocks > solvedBefore) lastProgressAtRef.current = Date.now()
    updateDecoderStats(decoder, currentMetadata)
  }, [updateDecoderStats])

  const initializeDecoder = useCallback((currentMetadata: TransferMetadata) => {
    if (currentMetadata.fecMode !== 'fountain') throw new Error('Receiver requires a RapidQR fountain transfer')
    if (!decoderRef.current) {
      decoderRef.current = new FountainDecoder(
        currentMetadata.transferId,
        currentMetadata.totalDataChunks,
        currentMetadata.chunkSize,
        currentMetadata.fountainC,
        currentMetadata.fountainDelta,
      )
      const waiting = pendingSymbolsRef.current
      pendingSymbolsRef.current = []
      for (const packet of waiting) feedSymbol(packet, currentMetadata)
    }
  }, [feedSymbol])

  const processFrame = useCallback((rawBytes: Uint8Array) => {
    try {
      const packet = decodePacket(rawBytes)
      if (transferIdRef.current !== null && transferIdRef.current !== packet.transferId) {
        setMessage('Ignoring a frame from a different transfer.')
        return
      }
      if (transferIdRef.current === null) transferIdRef.current = packet.transferId
      if (seenPacketsRef.current.has(packet.packetIndex)) {
        if (packet.type !== PacketType.Metadata) {
          setStats((current) => ({ ...current, duplicates: current.duplicates + 1 }))
        }
        return
      }
      seenPacketsRef.current.add(packet.packetIndex)
      void persistPacket(packet.transferId, packet.packetIndex, rawBytes).catch(() => undefined)

      let currentMetadata = metadataRef.current
      if (packet.type === PacketType.Metadata) {
        currentMetadata = readMetadata(packet)
        metadataRef.current = currentMetadata
        setMetadata(currentMetadata)
        initializeDecoder(currentMetadata)
      } else if (packet.type === PacketType.Fountain) {
        const now = Date.now()
        if (startedAtRef.current === 0) startedAtRef.current = now
        uniqueTimestampsRef.current.push(now)
        uniqueTimestampsRef.current = uniqueTimestampsRef.current.filter((timestamp) => timestamp >= now - 10_000)
        setStats((current) => ({ ...current, unique: seenPacketsRef.current.size, symbols: current.symbols + 1 }))
        if (currentMetadata) feedSymbol(packet, currentMetadata)
        else pendingSymbolsRef.current.push(packet)
      }

      setState('receiving')
      setMessage(currentMetadata ? `Solving ${currentMetadata.fileName}` : 'Transfer found — waiting for its metadata frame…')
    } catch (error) {
      setStats((current) => ({ ...current, corrupt: current.corrupt + 1 }))
      if (!(error instanceof PacketError)) setMessage(error instanceof Error ? error.message : 'Could not read frame.')
    }
  }, [feedSymbol, initializeDecoder])

  const startCamera = async () => {
    if (!videoRef.current) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('error')
      setMessage('Live camera requires HTTPS. Open an HTTPS deployment, or use “Capture QR frame” below.')
      return
    }
    setState('scanning')
    setMessage('Looking for a RapidQR v3 fountain stream…')
    try {
      controlsRef.current = await readerRef.current.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        videoRef.current,
        (result) => { if (result) processFrame(extractByteModePayload(result)) },
      )
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Camera permission was not granted.')
    }
  }

  const scanImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    try {
      const result = await readerRef.current.decodeFromImageUrl(url)
      processFrame(extractByteModePayload(result))
    } catch {
      setMessage('No readable RapidQR frame was found in that image.')
    } finally {
      URL.revokeObjectURL(url)
      event.target.value = ''
    }
  }

  const reset = () => {
    stopCamera()
    if (transferIdRef.current !== null) void clearTransfer(transferIdRef.current).catch(() => undefined)
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    seenPacketsRef.current.clear(); pendingSymbolsRef.current = []; transferIdRef.current = null; metadataRef.current = null
    decoderRef.current = null; finalizingRef.current = false; startedAtRef.current = 0; lastProgressAtRef.current = 0
    uniqueTimestampsRef.current = []; systematicSymbolsRef.current.clear()
    setMetadata(null); setStats(initialStats); setDownloadUrl(''); setRecoveredChunks(0); setVerifiedHash('')
    setState('idle'); setMessage('Camera is ready when you are.')
  }

  if (state === 'complete' && metadata) {
    return (
      <main className="workspace completion-page">
        <button className="back-link" onClick={onBack}>← Back to home</button>
        <section className="completion-card">
          <span className="success-icon"><Check /></span>
          <span className="step-label">Transfer complete</span>
          <h1>{metadata.fileName}</h1>
          <p>{formatBytes(metadata.fileSize)} solved from {stats.symbols.toLocaleString()} unique fountain symbols.</p>
          <div className="verification-box"><ShieldCheck /><div><strong>File integrity verified</strong><code>{verifiedHash}</code></div></div>
          <div className="completion-stats">
            <div><span>Duplicates ignored</span><strong>{stats.duplicates}</strong></div>
            <div><span>Corrupt rejected</span><strong>{stats.corrupt}</strong></div>
            <div><span>Blocks from recovery</span><strong>{recoveredChunks}</strong></div>
          </div>
          <a className="button primary download-button" href={downloadUrl} download={metadata.fileName}><Download /> Download file</a>
          <button className="button text-button" onClick={reset}><RefreshCw /> Receive another file</button>
        </section>
      </main>
    )
  }

  const total = metadata?.totalDataChunks ?? 0
  const progress = total ? Math.min(100, (stats.solved / total) * 100) : 0
  const elapsedSeconds = startedAtRef.current ? Math.max(1, (telemetryClock - startedAtRef.current) / 1000) : 0
  const recentWindow = Math.min(5, elapsedSeconds || 5)
  const recentUnique = uniqueTimestampsRef.current.filter((timestamp) => timestamp >= telemetryClock - recentWindow * 1000).length
  const uniqueFps = recentUnique / recentWindow
  const solveRate = elapsedSeconds ? stats.solved / elapsedSeconds : 0
  const throughput = solveRate * (metadata?.chunkSize ?? 0)
  const eta = solveRate > 0 && total ? (total - stats.solved) / solveRate : Number.NaN
  const lastProgress = lastProgressAtRef.current ? (telemetryClock - lastProgressAtRef.current) / 1000 : 0
  const duplicateRate = stats.symbols + stats.duplicates > 0 ? stats.duplicates / (stats.symbols + stats.duplicates) * 100 : 0

  return (
    <main className="workspace receiver-workspace">
      <div className="workspace-topline"><button className="back-link" onClick={onBack}>← Back to home</button><span className="privacy-chip"><ShieldCheck /> Local processing only</span></div>
      <section className="workspace-heading compact">
        <div><span className="step-label">Receiver / fountain decoder</span><h1>Scan the rateless stream</h1></div>
        <p>Every new QR adds a fresh equation; no specific missing frame is required.</p>
      </section>
      <section className="receiver-grid">
        <div className="camera-card">
          <div className="camera-viewport">
            <video ref={videoRef} muted playsInline />
            {state === 'idle' && <div className="camera-placeholder"><Camera /><strong>Camera is off</strong><span>Nothing is recorded or uploaded.</span></div>}
            <div className="scan-guide"><i /><i /><i /><i /><span className={state === 'scanning' || state === 'receiving' ? 'scan-beam' : ''} /></div>
          </div>
          <div className="camera-controls">
            {state === 'idle' || state === 'error' ? (
              <button className="button primary" onClick={startCamera}><Camera /> Start camera</button>
            ) : (
              <button className="button secondary" onClick={() => { stopCamera(); setState(metadata ? 'receiving' : 'idle'); setMessage(metadata ? `Receiving ${metadata.fileName} — camera paused.` : 'Camera paused.') }}><ScanLine /> Pause camera</button>
            )}
            <input ref={imageInputRef} hidden type="file" accept="image/*" capture="environment" onChange={scanImage} />
            <button className="button secondary" onClick={() => imageInputRef.current?.click()}><ImagePlus /> Capture QR frame</button>
          </div>
        </div>

        <aside className="receive-panel">
          <div className={`receive-status ${state}`}><span className="status-pulse" /><div><strong>{message}</strong><span>{metadata ? `${formatBytes(metadata.fileSize)} · ${metadata.profileId} profile` : 'Waiting for protocol v3 metadata'}</span></div></div>
          {metadata ? (
            <>
              <div className="receiving-file"><FileCheck2 /><div><strong>{metadata.fileName}</strong><span>Transfer ID {metadata.transferId.toString(16).toUpperCase()}</span></div></div>
              <div className="large-progress"><div><strong>{progress.toFixed(1)}%</strong><span>{stats.solved} / {total} source blocks solved</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>
            </>
          ) : <div className="empty-transfer"><span className="mini-qr large" /><p>Metadata announces the fountain seed, source-block count, filename, and final SHA-256.</p></div>}
          <div className="telemetry-grid">
            <div><span>Unique scan rate</span><strong>{uniqueFps.toFixed(1)} fps</strong></div>
            <div><span>Solve rate</span><strong>{solveRate.toFixed(2)} blocks/s</strong></div>
            <div><span>Actual throughput</span><strong>{formatBytes(throughput)}/s</strong></div>
            <div><span>ETA</span><strong>{formatDuration(eta)}</strong></div>
          </div>
          <div className="scan-stat-list">
            <div><span>Encoded symbols</span><strong>{stats.symbols.toLocaleString()}</strong></div>
            <div><span>Pending equations</span><strong>{stats.pendingEquations.toLocaleString()}</strong></div>
            <div><span>Unsolved source blocks</span><strong>{Math.max(0, total - stats.solved).toLocaleString()}</strong></div>
            <div><span>Duplicate rate</span><strong>{duplicateRate.toFixed(1)}%</strong></div>
            <div><span>Corrupt frames</span><strong className={stats.corrupt ? 'warn' : ''}>{stats.corrupt.toLocaleString()}</strong></div>
            <div><span>Since last progress</span><strong className={lastProgress > 10 ? 'warn' : ''}>{formatDuration(lastProgress)}</strong></div>
          </div>
          <div className="receiver-integrity"><ShieldCheck /><span><strong>Final SHA-256</strong><code>{truncateHash(metadata?.sha256 ?? '')}</code></span></div>
          {(stats.unique > 0 || state === 'error') && <button className="button secondary reset-button" onClick={reset}><RefreshCw /> Reset receiver</button>}
        </aside>
      </section>
    </main>
  )
}
