import { Result, ResultMetadataType } from '@zxing/library'

export function extractByteModePayload(result: Result): Uint8Array {
  const metadata = result.getResultMetadata()
  const segments = metadata?.get(ResultMetadataType.BYTE_SEGMENTS) as Uint8Array[] | undefined
  if (!segments || segments.length === 0) throw new Error('QR code does not contain a binary byte segment')
  const length = segments.reduce((total, segment) => total + segment.byteLength, 0)
  const payload = new Uint8Array(length)
  let offset = 0
  for (const segment of segments) {
    payload.set(segment, offset)
    offset += segment.byteLength
  }
  return payload
}
