/// <reference lib="webworker" />
import { prepareFountainTransfer } from '../core/transfer'
import { PrepareError, PrepareRequest, PrepareResponse } from '../core/types'
import { getProfile } from '../core/profiles'

self.onmessage = async (event: MessageEvent<PrepareRequest>) => {
  try {
    const request = event.data
    const transfer = await prepareFountainTransfer(
      new Uint8Array(request.buffer),
      { fileName: request.fileName, mimeType: request.mimeType, lastModified: request.lastModified },
      getProfile(request.profileId ?? 'balanced'),
    )
    const metadataPacket = transfer.metadataPacket.buffer as ArrayBuffer
    const sourceBlocks = transfer.sourceBlocks.map((block) => block.buffer as ArrayBuffer)
    const response: PrepareResponse = {
      ok: true,
      metadata: transfer.metadata,
      metadataPacket,
      sourceBlocks,
      dataPacketCount: transfer.metadata.totalDataChunks,
      encodedBytes: transfer.encodedBytes,
    }
    self.postMessage(response, { transfer: [metadataPacket, ...sourceBlocks] })
  } catch (error) {
    const response: PrepareError = { ok: false, error: error instanceof Error ? error.message : 'Encoding failed' }
    self.postMessage(response)
  }
}

export {}
