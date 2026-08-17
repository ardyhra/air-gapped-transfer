export const PROTOCOL_VERSION = 2
export const DEFAULT_CHUNK_SIZE = 700
export const DEFAULT_DATA_SHARDS = 10
export const DEFAULT_PARITY_SHARDS = 3

export enum PacketType {
  Metadata = 1,
  Data = 2,
  Parity = 3,
}

export interface TransferMetadata {
  protocol: 'RapidQR'
  version: 2
  transferId: number
  fileName: string
  mimeType: string
  fileSize: number
  lastModified: number
  sha256: string
  chunkSize: number
  totalDataChunks: number
  dataShards: number
  parityShards: number
  createdAt: string
}

export interface Packet {
  type: PacketType
  transferId: number
  packetIndex: number
  totalDataChunks: number
  groupIndex: number
  shardIndex: number
  dataShards: number
  parityShards: number
  payload: Uint8Array
}

export interface PreparedTransfer {
  metadata: TransferMetadata
  packets: Uint8Array[]
  dataPacketCount: number
  recoveryPacketCount: number
  encodedBytes: number
}

export interface PrepareRequest {
  buffer: ArrayBuffer
  fileName: string
  mimeType: string
  lastModified: number
  chunkSize?: number
  dataShards?: number
  parityShards?: number
}

export interface PrepareResponse {
  ok: true
  metadata: TransferMetadata
  packets: ArrayBuffer[]
  dataPacketCount: number
  recoveryPacketCount: number
  encodedBytes: number
}

export interface PrepareError {
  ok: false
  error: string
}
