import { decodePacket } from './packet'
import { PacketType } from './types'

interface ScheduledPacket {
  bytes: Uint8Array
  groupIndex: number
  shardIndex: number
  packetIndex: number
}

/**
 * Spreads adjacent optical losses across FEC groups instead of concentrating
 * them inside one group. Every shard round visits all groups before the next
 * shard from the same group is displayed.
 */
export function buildInterleavedSequence(packets: Uint8Array[], metadataInterval = 24): Uint8Array[] {
  if (packets.length < 2) return packets
  const metadata = packets.find((bytes) => decodePacket(bytes).type === PacketType.Metadata)
  if (!metadata) throw new Error('Transfer does not contain a metadata packet')

  const scheduled: ScheduledPacket[] = packets
    .map((bytes) => ({ bytes, packet: decodePacket(bytes) }))
    .filter(({ packet }) => packet.type !== PacketType.Metadata)
    .map(({ bytes, packet }) => ({
      bytes,
      groupIndex: packet.groupIndex,
      shardIndex: packet.shardIndex,
      packetIndex: packet.packetIndex,
    }))
    .sort((left, right) =>
      left.shardIndex - right.shardIndex ||
      left.groupIndex - right.groupIndex ||
      left.packetIndex - right.packetIndex,
    )

  const sequence: Uint8Array[] = []
  scheduled.forEach(({ bytes }, index) => {
    if (index % metadataInterval === 0) sequence.push(metadata)
    sequence.push(bytes)
  })
  return sequence
}
