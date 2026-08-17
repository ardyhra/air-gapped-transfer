import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser'
import { Camera, Check, Download, FileCheck2, ImagePlus, RefreshCw, ScanLine, ShieldCheck } from 'lucide-react'
import { decodePacket, PacketError } from '../core/packet'
import { clearTransfer, persistPacket } from '../core/packetStore'
import { assembleTransfer, readMetadata } from '../core/transfer'
import { Packet, PacketType, TransferMetadata } from '../core/types'
import { sha256 } from '../core/hash'
import { extractByteModePayload } from '../core/qrTransport'
import { formatBytes, truncateHash } from '../utils/format'

interface ReceiverProps { onBack: () => void }
type ReceiverState = 'idle' | 'scanning' | 'receiving' | 'verifying' | 'complete' | 'error'

interface ScanStats {
  unique: number
  duplicates: number
  corrupt: number
  dataReceived: number
  recoverableData: number
}

const initialStats: ScanStats = { unique: 0, duplicates: 0, corrupt: 0, dataReceived: 0, recoverableData: 0 }

export function Receiver({ onBack }: ReceiverProps) {
  const [state, setState] = useState<ReceiverState>('idle')
  const [metadata, setMetadata] = useState<TransferMetadata | null>(null)
  const [stats, setStats] = useState(initialStats)
  const [message, setMessage] = useState('Camera is ready when you are.')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [recoveredChunks, setRecoveredChunks] = useState(0)
  const [verifiedHash, setVerifiedHash] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const readerRef = useRef(new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 40, delayBetweenScanSuccess: 0 }))
  const packetBytesRef = useRef(new Map<number, Uint8Array>())
  const packetInfoRef = useRef(new Map<number, Packet>())
  const transferIdRef = useRef<number | null>(null)
  const metadataRef = useRef<TransferMetadata | null>(null)
  const finalizingRef = useRef(false)

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

  useEffect(() => () => {
    stopCamera()
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  }, [downloadUrl, stopCamera])

  const calculateStats = useCallback((currentMetadata: TransferMetadata | null) => {
    const packets = Array.from(packetInfoRef.current.values())
    const dataReceived = packets.filter((packet) => packet.type === PacketType.Data).length
    let recoverableData = dataReceived
    if (currentMetadata) {
      recoverableData = 0
      const groupCount = Math.ceil(currentMetadata.totalDataChunks / currentMetadata.dataShards)
      for (let group = 0; group < groupCount; group += 1) {
        const expected = Math.min(currentMetadata.dataShards, currentMetadata.totalDataChunks - group * currentMetadata.dataShards)
        const available = packets.filter((packet) => packet.groupIndex === group && packet.type !== PacketType.Metadata).length
        recoverableData += Math.min(expected, available)
      }
    }
    return {
      unique: packetBytesRef.current.size,
      dataReceived,
      recoverableData,
    }
  }, [])

  const finalize = useCallback(async (currentMetadata: TransferMetadata) => {
    if (finalizingRef.current) return
    finalizingRef.current = true
    setState('verifying')
    setMessage('Recovering missing shards and checking SHA-256…')
    try {
      const result = assembleTransfer(currentMetadata, Array.from(packetBytesRef.current.values()))
      const digest = await sha256(result.bytes)
      if (digest !== currentMetadata.sha256) throw new Error('Final SHA-256 does not match the sender.')
      const blob = new Blob([result.bytes], { type: currentMetadata.mimeType })
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      setRecoveredChunks(result.recoveredChunks)
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

  const processFrame = useCallback((rawBytes: Uint8Array) => {
    try {
      const packet = decodePacket(rawBytes)
      if (transferIdRef.current !== null && transferIdRef.current !== packet.transferId) {
        setMessage('Ignoring a frame from a different transfer.')
        return
      }
      if (transferIdRef.current === null) transferIdRef.current = packet.transferId
      if (packetBytesRef.current.has(packet.packetIndex)) {
        setStats((current) => ({ ...current, duplicates: current.duplicates + 1 }))
        return
      }

      packetBytesRef.current.set(packet.packetIndex, rawBytes.slice())
      packetInfoRef.current.set(packet.packetIndex, packet)
      void persistPacket(packet.transferId, packet.packetIndex, rawBytes).catch(() => undefined)
      let currentMetadata = metadataRef.current
      if (packet.type === PacketType.Metadata) {
        currentMetadata = readMetadata(packet)
        metadataRef.current = currentMetadata
        setMetadata(currentMetadata)
      }
      setState('receiving')
      setMessage(currentMetadata ? `Receiving ${currentMetadata.fileName}` : 'Transfer found — waiting for its metadata frame…')

      const nextStats = calculateStats(currentMetadata)
      setStats((current) => ({ ...nextStats, duplicates: current.duplicates, corrupt: current.corrupt }))
      if (currentMetadata && nextStats.recoverableData >= currentMetadata.totalDataChunks) void finalize(currentMetadata)
    } catch (error) {
      setStats((current) => ({ ...current, corrupt: current.corrupt + 1 }))
      if (!(error instanceof PacketError)) setMessage(error instanceof Error ? error.message : 'Could not read frame.')
    }
  }, [calculateStats, finalize])

  const startCamera = async () => {
    if (!videoRef.current) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('error')
      setMessage('Live camera requires HTTPS. Open an HTTPS deployment, or use “Capture QR frame” below on this HTTP connection.')
      return
    }
    setState('scanning')
    setMessage('Looking for a RapidQR stream…')
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
    packetBytesRef.current.clear(); packetInfoRef.current.clear(); transferIdRef.current = null; metadataRef.current = null
    finalizingRef.current = false
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
          <p>{formatBytes(metadata.fileSize)} recovered from {stats.unique.toLocaleString()} unique optical frames.</p>
          <div className="verification-box"><ShieldCheck /><div><strong>File integrity verified</strong><code>{verifiedHash}</code></div></div>
          <div className="completion-stats">
            <div><span>Duplicates ignored</span><strong>{stats.duplicates}</strong></div>
            <div><span>Corrupt rejected</span><strong>{stats.corrupt}</strong></div>
            <div><span>Frames recovered</span><strong>{recoveredChunks}</strong></div>
          </div>
          <a className="button primary download-button" href={downloadUrl} download={metadata.fileName}><Download /> Download file</a>
          <button className="button text-button" onClick={reset}><RefreshCw /> Receive another file</button>
        </section>
      </main>
    )
  }

  const total = metadata?.totalDataChunks ?? 0
  const progress = total ? Math.min(100, (stats.recoverableData / total) * 100) : 0
  const missing = total ? Math.max(0, total - stats.dataReceived) : 0
  return (
    <main className="workspace receiver-workspace">
      <div className="workspace-topline"><button className="back-link" onClick={onBack}>← Back to home</button><span className="privacy-chip"><ShieldCheck /> Local processing only</span></div>
      <section className="workspace-heading compact">
        <div><span className="step-label">Receiver</span><h1>Scan the optical stream</h1></div>
        <p>Hold steady and keep the entire QR code inside the guide.</p>
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
          <div className={`receive-status ${state}`}><span className="status-pulse" /><div><strong>{message}</strong><span>{metadata ? `${formatBytes(metadata.fileSize)} · ${metadata.mimeType}` : 'Waiting for protocol v2 metadata'}</span></div></div>
          {metadata ? (
            <>
              <div className="receiving-file"><FileCheck2 /><div><strong>{metadata.fileName}</strong><span>Transfer ID {metadata.transferId.toString(16).toUpperCase()}</span></div></div>
              <div className="large-progress"><div><strong>{progress.toFixed(1)}%</strong><span>{stats.recoverableData} / {total} recoverable chunks</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>
            </>
          ) : <div className="empty-transfer"><span className="mini-qr large" /><p>The filename and expected SHA-256 arrive inside a recurring metadata frame.</p></div>}
          <div className="scan-stat-list">
            <div><span>Unique frames</span><strong>{stats.unique.toLocaleString()}</strong></div>
            <div><span>Missing data frames</span><strong>{missing.toLocaleString()}</strong></div>
            <div><span>Duplicates ignored</span><strong>{stats.duplicates.toLocaleString()}</strong></div>
            <div><span>Corrupt frames</span><strong className={stats.corrupt ? 'warn' : ''}>{stats.corrupt.toLocaleString()}</strong></div>
          </div>
          <div className="receiver-integrity"><ShieldCheck /><span><strong>Final SHA-256</strong><code>{truncateHash(metadata?.sha256 ?? '')}</code></span></div>
          {(stats.unique > 0 || state === 'error') && <button className="button secondary reset-button" onClick={reset}><RefreshCw /> Reset receiver</button>}
        </aside>
      </section>
    </main>
  )
}
