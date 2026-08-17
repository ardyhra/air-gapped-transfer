import { lazy, Suspense, useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Home } from './components/Home'
import { Logo } from './components/Logo'

const Sender = lazy(() => import('./components/Sender').then((module) => ({ default: module.Sender })))
const Receiver = lazy(() => import('./components/Receiver').then((module) => ({ default: module.Receiver })))

type Mode = 'home' | 'send' | 'receive'

export default function App() {
  const [mode, setMode] = useState<Mode>('home')
  const [online, setOnline] = useState(navigator.onLine)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="logo-button" onClick={() => setMode('home')}><Logo /></button>
        <nav aria-label="Main navigation">
          <button className={mode === 'send' ? 'active' : ''} onClick={() => setMode('send')}>Send</button>
          <button className={mode === 'receive' ? 'active' : ''} onClick={() => setMode('receive')}>Receive</button>
        </nav>
        <span className={`network-status ${online ? '' : 'offline'}`}><WifiOff /> {online ? 'Transfer stays offline' : 'App running offline'}</span>
      </header>
      {mode === 'home' && <Home onChoose={setMode} />}
      <Suspense fallback={<div className="route-loading"><span className="spinner" /> Loading optical tools…</div>}>
        {mode === 'send' && <Sender onBack={() => setMode('home')} />}
        {mode === 'receive' && <Receiver onBack={() => setMode('home')} />}
      </Suspense>
      <footer><span>RapidQR Protocol v3</span><span>CRC32 · SHA-256 · LT fountain</span><span>100% client-side</span></footer>
      {needRefresh && <button className="update-toast" onClick={() => void updateServiceWorker(true)}>A new version is ready · Update</button>}
    </div>
  )
}
