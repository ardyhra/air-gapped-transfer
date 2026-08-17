/// <reference lib="webworker" />
import { prepareTransfer } from '../core/transfer'
import { PrepareError, PrepareRequest, PrepareResponse } from '../core/types'

self.onmessage = async (event: MessageEvent<PrepareRequest>) => {
  try {
    const request = event.data
    const transfer = await prepareTransfer(
      new Uint8Array(request.buffer),
      { fileName: request.fileName, mimeType: request.mimeType, lastModified: request.lastModified },
      { chunkSize: request.chunkSize, dataShards: request.dataShards, parityShards: request.parityShards },
    )
    const buffers = transfer.packets.map((packet) => packet.buffer as ArrayBuffer)
    const response: PrepareResponse = {
      ok: true,
      metadata: transfer.metadata,
      packets: buffers,
      dataPacketCount: transfer.dataPacketCount,
      recoveryPacketCount: transfer.recoveryPacketCount,
      encodedBytes: transfer.encodedBytes,
    }
    self.postMessage(response, { transfer: buffers })
  } catch (error) {
    const response: PrepareError = { ok: false, error: error instanceof Error ? error.message : 'Encoding failed' }
    self.postMessage(response)
  }
}

export {}
