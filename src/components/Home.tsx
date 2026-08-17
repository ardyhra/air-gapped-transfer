import { ArrowDownToLine, ArrowUpFromLine, Camera, Check, LockKeyhole, RadioTower } from 'lucide-react'

interface HomeProps {
  onChoose: (mode: 'send' | 'receive') => void
}

export function Home({ onChoose }: HomeProps) {
  return (
    <main className="home">
      <section className="hero">
        <div className="eyebrow"><span /> Air-gapped optical transfer</div>
        <h1>Move files through <em>light.</em></h1>
        <p className="hero-copy">
          No network. No pairing. No cable. RapidQR turns any file into a resilient stream of QR frames,
          then rebuilds it locally on the receiving device.
        </p>
        <div className="mode-grid">
          <button className="mode-card send-card" onClick={() => onChoose('send')}>
            <span className="mode-icon"><ArrowUpFromLine /></span>
            <span className="mode-label">On the computer</span>
            <strong>Send a file</strong>
            <small>Choose a file and display the optical stream.</small>
            <span className="mode-action">Open sender <span>↗</span></span>
          </button>
          <button className="mode-card receive-card" onClick={() => onChoose('receive')}>
            <span className="mode-icon"><Camera /></span>
            <span className="mode-label">On the phone</span>
            <strong>Receive a file</strong>
            <small>Point the camera at the sender's screen.</small>
            <span className="mode-action">Open scanner <span>↗</span></span>
          </button>
        </div>
      </section>

      <section className="signal-card" aria-label="Protocol overview">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="signal-center"><RadioTower /></div>
        <div className="signal-node node-file"><ArrowUpFromLine /><span>Binary file</span></div>
        <div className="signal-node node-frame"><span className="mini-qr" /><span>QR frames</span></div>
        <div className="signal-node node-camera"><Camera /><span>Camera</span></div>
        <div className="signal-node node-output"><ArrowDownToLine /><span>Verified file</span></div>
      </section>

      <section className="trust-row">
        <div><LockKeyhole /><span><strong>Private by design</strong>Files never leave your devices.</span></div>
        <div><RadioTower /><span><strong>Networkless</strong>Only photons cross the air gap.</span></div>
        <div><Check /><span><strong>Loss tolerant</strong>CRC32 + rateless fountain recovery.</span></div>
      </section>
    </main>
  )
}
