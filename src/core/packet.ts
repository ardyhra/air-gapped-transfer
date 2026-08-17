import { crc32 } from './crc32'
import { Packet, PacketType, PROTOCOL_VERSION } from './types'

export const PACKET_MAGIC = 0x5251
export const HEADER_SIZE = 29
export const CHECKSUM_SIZE = 4

export class PacketError extends Error {}

export function encodePacket(packet: Packet): Uint8Array {
  if (packet.payload.byteLength > 0xffff) throw new PacketError('Payload is too large')
  const encoded = new Uint8Array(HEADER_SIZE + packet.payload.byteLength + CHECKSUM_SIZE)
  const view = new DataView(encoded.buffer)
  view.setUint16(0, PACKET_MAGIC)
  view.setUint8(2, PROTOCOL_VERSION)
  view.setUint8(3, packet.type)
  view.setUint8(4, packet.type === PacketType.Parity ? 1 : 0)
  view.setUint32(5, packet.transferId)
  view.setUint32(9, packet.packetIndex)
  view.setUint32(13, packet.totalDataChunks)
  view.setUint32(17, packet.groupIndex)
  view.setUint16(21, packet.shardIndex)
  view.setUint16(23, packet.dataShards)
  view.setUint16(25, packet.parityShards)
  view.setUint16(27, packet.payload.byteLength)
  encoded.set(packet.payload, HEADER_SIZE)
  view.setUint32(encoded.byteLength - CHECKSUM_SIZE, crc32(encoded.subarray(0, -CHECKSUM_SIZE)))
  return encoded
}

export function decodePacket(encoded: Uint8Array): Packet {
  if (encoded.byteLength < HEADER_SIZE + CHECKSUM_SIZE) throw new PacketError('Frame is too short')
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  if (view.getUint16(0) !== PACKET_MAGIC) throw new PacketError('Not a RapidQR frame')
  if (view.getUint8(2) !== PROTOCOL_VERSION) throw new PacketError('Unsupported protocol version')
  const payloadLength = view.getUint16(27)
  const expectedLength = HEADER_SIZE + payloadLength + CHECKSUM_SIZE
  if (encoded.byteLength !== expectedLength) throw new PacketError('Invalid frame length')
  const storedCrc = view.getUint32(encoded.byteLength - CHECKSUM_SIZE)
  const actualCrc = crc32(encoded.subarray(0, -CHECKSUM_SIZE))
  if (storedCrc !== actualCrc) throw new PacketError('CRC mismatch')
  const type = view.getUint8(3)
  if (![PacketType.Metadata, PacketType.Data, PacketType.Parity, PacketType.Fountain].includes(type)) {
    throw new PacketError('Unknown packet type')
  }
  return {
    type,
    transferId: view.getUint32(5),
    packetIndex: view.getUint32(9),
    totalDataChunks: view.getUint32(13),
    groupIndex: view.getUint32(17),
    shardIndex: view.getUint16(21),
    dataShards: view.getUint16(23),
    parityShards: view.getUint16(25),
    payload: encoded.slice(HEADER_SIZE, HEADER_SIZE + payloadLength),
  }
}
