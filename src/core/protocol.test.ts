import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { crc32 } from './crc32'
import { decodePacket, encodePacket, PacketError } from './packet'
import { createParity, recoverData } from './reedSolomon'
import { assembleTransfer, prepareTransfer } from './transfer'
import { PacketType } from './types'
import { extractByteModePayload } from './qrTransport'
import { sha256, sha256Fallback } from './hash'
import { buildInterleavedSequence } from './schedule'

describe('CRC32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('SHA-256', () => {
  it('matches the standard abc test vector', async () => {
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('keeps the same result without Web Crypto', () => {
    const digest = sha256Fallback(new TextEncoder().encode('abc'))
    expect(Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('RapidQR packet', () => {
  it('round-trips a binary payload and rejects corruption', () => {
    const packet = encodePacket({
      type: PacketType.Data,
      transferId: 42,
      packetIndex: 7,
      totalDataChunks: 11,
      groupIndex: 0,
      shardIndex: 3,
      dataShards: 10,
      parityShards: 3,
      payload: new Uint8Array([0, 127, 128, 255]),
    })
    expect(decodePacket(packet)).toMatchObject({ transferId: 42, packetIndex: 7, shardIndex: 3 })
    expect(Array.from(decodePacket(packet).payload)).toEqual([0, 127, 128, 255])
    packet[30] ^= 1
    expect(() => decodePacket(packet)).toThrow(PacketError)
  })

  it('survives the real QR encoder and ZXing decoder as raw bytes', () => {
    const payload = Uint8Array.from({ length: 256 }, (_, index) => index)
    const packet = encodePacket({
      type: PacketType.Data,
      transferId: 0xfedcba98,
      packetIndex: 99,
      totalDataChunks: 100,
      groupIndex: 4,
      shardIndex: 8,
      dataShards: 10,
      parityShards: 3,
      payload,
    })
    const qr = QRCode.create([{ data: packet, mode: 'byte' }], { errorCorrectionLevel: 'L' })
    const scale = 5
    const quietZone = 4
    const moduleWidth = qr.modules.size + quietZone * 2
    const imageWidth = moduleWidth * scale
    const luminance = new Uint8ClampedArray(imageWidth * imageWidth).fill(255)
    for (let row = 0; row < qr.modules.size; row += 1) {
      for (let column = 0; column < qr.modules.size; column += 1) {
        if (!qr.modules.get(row, column)) continue
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            const pixelX = (column + quietZone) * scale + x
            const pixelY = (row + quietZone) * scale + y
            luminance[pixelY * imageWidth + pixelX] = 0
          }
        }
      }
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, imageWidth, imageWidth)))
    const decoded = extractByteModePayload(new QRCodeReader().decode(bitmap))
    expect(Array.from(decoded)).toEqual(Array.from(packet))
    expect(Array.from(decodePacket(decoded).payload)).toEqual(Array.from(payload))
  })
})

describe('Reed–Solomon erasure coding', () => {
  it('recovers any three missing shards from three parity shards', () => {
    const data = Array.from({ length: 10 }, (_, shard) =>
      Uint8Array.from({ length: 64 }, (_, byte) => (shard * 37 + byte * 11) & 0xff),
    )
    const parity = createParity(data, 3)
    const damaged: Array<Uint8Array | undefined> = [...data, ...parity]
    damaged[1] = undefined
    damaged[6] = undefined
    damaged[9] = undefined
    const recovered = recoverData(damaged, 10, 3)
    expect(recovered.map((shard) => Array.from(shard))).toEqual(data.map((shard) => Array.from(shard)))
  })
})

describe('file transfer', () => {
  it('reassembles a file with dropped data frames and verifies its hash', async () => {
    const input = Uint8Array.from({ length: 7_321 }, (_, index) => (index * 29) & 0xff)
    const transfer = await prepareTransfer(
      input,
      { fileName: 'sample.bin', mimeType: 'application/octet-stream', lastModified: 1 },
      { chunkSize: 200, dataShards: 8, parityShards: 3 },
    )
    const kept = transfer.packets.filter((encoded) => {
      const packet = decodePacket(encoded)
      return packet.type !== PacketType.Data || packet.shardIndex >= 2
    })
    const result = assembleTransfer(transfer.metadata, kept)
    expect(result.recoveredChunks).toBeGreaterThan(0)
    expect(Array.from(result.bytes)).toEqual(Array.from(input))
  })

  it('interleaves neighboring frames across Reed–Solomon groups', async () => {
    const input = Uint8Array.from({ length: 4_000 }, (_, index) => index & 0xff)
    const transfer = await prepareTransfer(
      input,
      { fileName: 'interleaved.bin', mimeType: 'application/octet-stream', lastModified: 1 },
      { chunkSize: 100, dataShards: 5, parityShards: 2 },
    )
    const sequence = buildInterleavedSequence(transfer.packets, 10_000)
      .map(decodePacket)
      .filter((packet) => packet.type !== PacketType.Metadata)
    expect(sequence.slice(0, 8).map((packet) => packet.shardIndex)).toEqual(Array(8).fill(0))
    expect(sequence.slice(0, 8).map((packet) => packet.groupIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(sequence.slice(8, 16).map((packet) => packet.shardIndex)).toEqual(Array(8).fill(1))
  })
})
