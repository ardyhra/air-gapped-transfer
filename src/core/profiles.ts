import { QRCodeErrorCorrectionLevel } from 'qrcode'

export interface TransmissionProfile {
  id: 'reliable' | 'balanced' | 'turbo'
  name: string
  description: string
  chunkSize: number
  defaultFps: number
  maxFps: number
  errorCorrectionLevel: QRCodeErrorCorrectionLevel
}

export const TRANSMISSION_PROFILES: TransmissionProfile[] = [
  {
    id: 'reliable', name: 'Reliable', description: 'Largest QR modules for difficult cameras',
    chunkSize: 240, defaultFps: 6, maxFps: 10, errorCorrectionLevel: 'M',
  },
  {
    id: 'balanced', name: 'Balanced', description: 'Recommended for most phone cameras',
    chunkSize: 360, defaultFps: 9, maxFps: 15, errorCorrectionLevel: 'M',
  },
  {
    id: 'turbo', name: 'Turbo', description: 'Higher density for excellent focus and lighting',
    chunkSize: 520, defaultFps: 12, maxFps: 20, errorCorrectionLevel: 'L',
  },
]

export function getProfile(id: TransmissionProfile['id']): TransmissionProfile {
  return TRANSMISSION_PROFILES.find((profile) => profile.id === id) ?? TRANSMISSION_PROFILES[1]
}
