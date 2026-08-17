import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const [githubOwner, githubRepository] = (process.env.GITHUB_REPOSITORY ?? '').split('/')
const isGithubPagesBuild = process.env.GITHUB_ACTIONS === 'true' && Boolean(githubRepository)
const base = isGithubPagesBuild && githubRepository !== `${githubOwner}.github.io`
  ? `/${githubRepository}/`
  : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['rapidqr.svg'],
      manifest: {
        name: 'RapidQR — Air-gapped Transfer',
        short_name: 'RapidQR',
        description: 'Transfer files through light, with no network or pairing.',
        theme_color: '#07110f',
        background_color: '#07110f',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'rapidqr.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: `${base}index.html`
      }
    })
  ],
  worker: { format: 'es' },
  test: { environment: 'node', globals: true }
})
