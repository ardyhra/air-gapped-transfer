import { sha256 } from './hash'
import { decodePacket, encodePacket } from './packet'
import { createParity, recoverData } from './reedSolomon'
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_DATA_SHARDS,
  DEFAULT_PARITY_SHARDS,
  Packet,
  PacketType,
  PreparedTransfer,
  TransferMetadata,
} from './types'
import { FOUNTAIN_C, FOUNTAIN_DELTA } from './fountain'
import { TransmissionProfile } from './profiles'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface FileDescriptor {
  fileName: string
  mimeType: string
  lastModified: number
}

function randomTransferId(): number {
  const id = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(id)
  else id[0] = Math.floor(Math.random() * 0x100000000)
  return id[0]
}

export async function prepareTransfer(
  source: Uint8Array,
  descriptor: FileDescriptor,
  options: { chunkSize?: number; dataShards?: number; parityShards?: number } = {},
): Promise<PreparedTransfer> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const configuredDataShards = options.dataShards ?? DEFAULT_DATA_SHARDS
  const parityShards = options.parityShards ?? DEFAULT_PARITY_SHARDS
  const totalDataChunks = Math.max(1, Math.ceil(source.byteLength / chunkSize))
  const transferId = randomTransferId()
  const metadata: TransferMetadata = {
    protocol: 'RapidQR',
    version: 3,
    transferId,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType || 'application/octet-stream',
    fileSize: source.byteLength,
    lastModified: descriptor.lastModified,
    sha256: await sha256(source),
    chunkSize,
    totalDataChunks,
    dataShards: configuredDataShards,
    parityShards,
    fecMode: 'reed-solomon',
    profileId: 'balanced',
    fountainC: FOUNTAIN_C,
    fountainDelta: FOUNTAIN_DELTA,
    createdAt: new Date().toISOString(),
  }

  const packets: Uint8Array[] = []
  let packetIndex = 0
  packets.push(
    encodePacket({
      type: PacketType.Metadata,
      transferId,
      packetIndex: packetIndex++,
      totalDataChunks,
      groupIndex: 0,
      shardIndex: 0,
      dataShards: configuredDataShards,
      parityShards,
      payload: encoder.encode(JSON.stringify(metadata)),
    }),
  )

  let recoveryPacketCount = 0
  const groupCount = Math.ceil(totalDataChunks / configuredDataShards)
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const firstChunk = groupIndex * configuredDataShards
    const groupDataCount = Math.min(configuredDataShards, totalDataChunks - firstChunk)
    const data = Array.from({ length: groupDataCount }, (_, localIndex) => {
      const chunk = new Uint8Array(chunkSize)
      const start = (firstChunk + localIndex) * chunkSize
      chunk.set(source.subarray(start, Math.min(start + chunkSize, source.byteLength)))
      return chunk
    })
    const parity = createParity(data, parityShards)
    data.forEach((payload, shardIndex) => {
      packets.push(
        encodePacket({
          type: PacketType.Data,
          transferId,
          packetIndex: packetIndex++,
          totalDataChunks,
          groupIndex,
          shardIndex,
          dataShards: groupDataCount,
          parityShards,
          payload,
        }),
      )
    })
    parity.forEach((payload, parityIndex) => {
      packets.push(
        encodePacket({
          type: PacketType.Parity,
          transferId,
          packetIndex: packetIndex++,
          totalDataChunks,
          groupIndex,
          shardIndex: groupDataCount + parityIndex,
          dataShards: groupDataCount,
          parityShards,
          payload,
        }),
      )
      recoveryPacketCount += 1
    })
  }
  return {
    metadata,
    packets,
    dataPacketCount: totalDataChunks,
    recoveryPacketCount,
    encodedBytes: packets.reduce((total, packet) => total + packet.byteLength, 0),
  }
}

export interface PreparedFountainTransfer {
  metadata: TransferMetadata
  metadataPacket: Uint8Array
  sourceBlocks: Uint8Array[]
  encodedBytes: number
}

export async function prepareFountainTransfer(
  source: Uint8Array,
  descriptor: FileDescriptor,
  profile: TransmissionProfile,
): Promise<PreparedFountainTransfer> {
  const chunkSize = profile.chunkSize
  const totalDataChunks = Math.max(1, Math.ceil(source.byteLength / chunkSize))
  const transferId = randomTransferId()
  const metadata: TransferMetadata = {
    protocol: 'RapidQR',
    version: 3,
    transferId,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType || 'application/octet-stream',
    fileSize: source.byteLength,
    lastModified: descriptor.lastModified,
    sha256: await sha256(source),
    chunkSize,
    totalDataChunks,
    dataShards: 0,
    parityShards: 0,
    fecMode: 'fountain',
    profileId: profile.id,
    fountainC: FOUNTAIN_C,
    fountainDelta: FOUNTAIN_DELTA,
    createdAt: new Date().toISOString(),
  }
  const sourceBlocks = Array.from({ length: totalDataChunks }, (_, index) => {
    const block = new Uint8Array(chunkSize)
    const start = index * chunkSize
    block.set(source.subarray(start, Math.min(start + chunkSize, source.byteLength)))
    return block
  })
  const metadataPacket = encodePacket({
    type: PacketType.Metadata,
    transferId,
    packetIndex: 0,
    totalDataChunks,
    groupIndex: 0,
    shardIndex: 0,
    dataShards: 0,
    parityShards: 0,
    payload: encoder.encode(JSON.stringify(metadata)),
  })
  return {
    metadata,
    metadataPacket,
    sourceBlocks,
    encodedBytes: sourceBlocks.reduce((total, block) => total + block.byteLength, metadataPacket.byteLength),
  }
}

export function readMetadata(packet: Packet): TransferMetadata {
  if (packet.type !== PacketType.Metadata) throw new Error('Packet does not contain metadata')
  const metadata = JSON.parse(decoder.decode(packet.payload)) as TransferMetadata
  if (
    metadata.protocol !== 'RapidQR' ||
    metadata.version !== 3 ||
    metadata.transferId !== packet.transferId ||
    metadata.totalDataChunks !== packet.totalDataChunks
  ) {
    throw new Error('Invalid transfer metadata')
  }
  return metadata
}

export interface AssemblyResult {
  bytes: Uint8Array
  recoveredChunks: number
}

export function assembleTransfer(metadata: TransferMetadata, encodedPackets: Uint8Array[]): AssemblyResult {
  const byGroup = new Map<number, Packet[]>()
  for (const encoded of encodedPackets) {
    const packet = decodePacket(encoded)
    if (packet.transferId !== metadata.transferId || packet.type === PacketType.Metadata) continue
    const group = byGroup.get(packet.groupIndex) ?? []
    group.push(packet)
    byGroup.set(packet.groupIndex, group)
  }

  const chunks: Uint8Array[] = []
  let recoveredChunks = 0
  const groupCount = Math.ceil(metadata.totalDataChunks / metadata.dataShards)
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const packets = byGroup.get(groupIndex) ?? []
    const expectedData = Math.min(metadata.dataShards, metadata.totalDataChunks - chunks.length)
    const shards: Array<Uint8Array | undefined> = Array(expectedData + metadata.parityShards)
    for (const packet of packets) {
      if (packet.dataShards === expectedData && packet.shardIndex < shards.length && !shards[packet.shardIndex]) {
        shards[packet.shardIndex] = packet.payload
      }
    }
    const missingBeforeRecovery = Array.from(shards.slice(0, expectedData)).filter((shard) => !shard).length
    if (missingBeforeRecovery > 0 && shards.filter(Boolean).length < expectedData) {
      throw new Error(`Group ${groupIndex + 1} still needs ${expectedData - shards.filter(Boolean).length} frame(s)`)
    }
    const data = missingBeforeRecovery > 0 ? recoverData(shards, expectedData, metadata.parityShards) : shards.slice(0, expectedData) as Uint8Array[]
    recoveredChunks += missingBeforeRecovery
    chunks.push(...data)
  }

  const output = new Uint8Array(metadata.fileSize)
  let offset = 0
  for (const chunk of chunks) {
    const length = Math.min(chunk.byteLength, output.byteLength - offset)
    output.set(chunk.subarray(0, length), offset)
    offset += length
  }
  return { bytes: output, recoveredChunks }
}
