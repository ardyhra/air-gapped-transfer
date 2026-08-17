import { encodePacket } from './packet'
import { PacketType, TransferMetadata } from './types'

export const FOUNTAIN_C = 0.1
export const FOUNTAIN_DELTA = 0.05
const distributionCache = new Map<string, Float64Array>()

function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}

function symbolSeed(transferId: number, symbolId: number): number {
  return (transferId ^ Math.imul(symbolId + 1, 0x9e3779b1) ^ 0x85ebca6b) >>> 0
}

function degreeDistribution(blockCount: number, c: number, delta: number): Float64Array {
  const cacheKey = `${blockCount}:${c}:${delta}`
  const cached = distributionCache.get(cacheKey)
  if (cached) return cached
  if (blockCount === 1) return new Float64Array([1])
  const weights = new Float64Array(blockCount)
  weights[0] = 1 / blockCount
  for (let degree = 2; degree <= blockCount; degree += 1) weights[degree - 1] = 1 / (degree * (degree - 1))

  const r = c * Math.log(blockCount / delta) * Math.sqrt(blockCount)
  const pivot = Math.max(1, Math.min(blockCount, Math.floor(blockCount / Math.max(r, 1))))
  for (let degree = 1; degree < pivot; degree += 1) weights[degree - 1] += r / (degree * blockCount)
  weights[pivot - 1] += (r * Math.log(Math.max(r / delta, 1))) / blockCount

  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cumulative = 0
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index] / total
    weights[index] = cumulative
  }
  weights[weights.length - 1] = 1
  distributionCache.set(cacheKey, weights)
  return weights
}

export function fountainIndexes(
  transferId: number,
  symbolId: number,
  blockCount: number,
  c = FOUNTAIN_C,
  delta = FOUNTAIN_DELTA,
): number[] {
  if (symbolId < blockCount) return [symbolId]
  const random = createRandom(symbolSeed(transferId, symbolId))
  const sample = random()
  const distribution = degreeDistribution(blockCount, c, delta)
  let degree = distribution.findIndex((threshold) => sample <= threshold) + 1
  degree = Math.max(1, Math.min(blockCount, degree))
  const indexes = new Set<number>()
  while (indexes.size < degree) indexes.add(Math.floor(random() * blockCount))
  return Array.from(indexes).sort((left, right) => left - right)
}

export function createFountainSymbol(
  blocks: Uint8Array[],
  transferId: number,
  symbolId: number,
  knownIndexes?: number[],
): Uint8Array {
  const indexes = knownIndexes ?? fountainIndexes(transferId, symbolId, blocks.length)
  const payload = new Uint8Array(blocks[0].byteLength)
  for (const blockIndex of indexes) {
    const block = blocks[blockIndex]
    for (let byte = 0; byte < payload.byteLength; byte += 1) payload[byte] ^= block[byte]
  }
  return payload
}

export function createFountainPacket(metadata: TransferMetadata, blocks: Uint8Array[], symbolId: number): Uint8Array {
  const indexes = fountainIndexes(
    metadata.transferId, symbolId, metadata.totalDataChunks, metadata.fountainC, metadata.fountainDelta,
  )
  return encodePacket({
    type: PacketType.Fountain,
    transferId: metadata.transferId,
    packetIndex: symbolId + 1,
    totalDataChunks: metadata.totalDataChunks,
    groupIndex: symbolId,
    shardIndex: indexes.length,
    dataShards: 0,
    parityShards: 0,
    payload: createFountainSymbol(blocks, metadata.transferId, symbolId, indexes),
  })
}

interface Equation {
  indexes: Set<number>
  payload: Uint8Array
}

export class FountainDecoder {
  private readonly known = new Map<number, Uint8Array>()
  private readonly equations = new Map<number, Equation>()
  private readonly adjacency = new Map<number, Set<number>>()
  private nextEquationId = 0

  constructor(
    readonly transferId: number,
    readonly blockCount: number,
    readonly blockSize: number,
    readonly c = FOUNTAIN_C,
    readonly delta = FOUNTAIN_DELTA,
  ) {}

  get solvedBlocks(): number { return this.known.size }
  get pendingEquations(): number { return this.equations.size }
  get complete(): boolean { return this.known.size === this.blockCount }

  addSymbol(symbolId: number, payload: Uint8Array): number {
    if (payload.byteLength !== this.blockSize) throw new Error('Fountain symbol has an invalid size')
    const indexes = fountainIndexes(this.transferId, symbolId, this.blockCount, this.c, this.delta)
    const reducedPayload = payload.slice()
    const unresolved: number[] = []
    for (const index of indexes) {
      const block = this.known.get(index)
      if (block) {
        for (let byte = 0; byte < reducedPayload.byteLength; byte += 1) reducedPayload[byte] ^= block[byte]
      } else {
        unresolved.push(index)
      }
    }
    if (unresolved.length === 0) return 0
    const solvedBefore = this.known.size
    if (unresolved.length === 1) {
      this.solve(unresolved[0], reducedPayload)
    } else {
      const equationId = this.nextEquationId++
      this.equations.set(equationId, { indexes: new Set(unresolved), payload: reducedPayload })
      for (const index of unresolved) {
        const linked = this.adjacency.get(index) ?? new Set<number>()
        linked.add(equationId)
        this.adjacency.set(index, linked)
      }
    }
    return this.known.size - solvedBefore
  }

  private solve(initialIndex: number, initialPayload: Uint8Array): void {
    const queue: Array<[number, Uint8Array]> = [[initialIndex, initialPayload]]
    while (queue.length > 0) {
      const [blockIndex, blockPayload] = queue.shift()!
      if (this.known.has(blockIndex)) continue
      this.known.set(blockIndex, blockPayload)
      const linkedEquations = Array.from(this.adjacency.get(blockIndex) ?? [])
      this.adjacency.delete(blockIndex)
      for (const equationId of linkedEquations) {
        const equation = this.equations.get(equationId)
        if (!equation || !equation.indexes.delete(blockIndex)) continue
        for (let byte = 0; byte < equation.payload.byteLength; byte += 1) equation.payload[byte] ^= blockPayload[byte]
        if (equation.indexes.size === 1) {
          const solvedIndex = equation.indexes.values().next().value as number
          this.removeEquation(equationId, equation)
          queue.push([solvedIndex, equation.payload])
        } else if (equation.indexes.size === 0) {
          this.removeEquation(equationId, equation)
        }
      }
    }
  }

  private removeEquation(equationId: number, equation: Equation): void {
    this.equations.delete(equationId)
    for (const index of equation.indexes) {
      const linked = this.adjacency.get(index)
      linked?.delete(equationId)
      if (linked?.size === 0) this.adjacency.delete(index)
    }
  }

  assemble(fileSize: number): Uint8Array {
    if (!this.complete) throw new Error(`${this.blockCount - this.known.size} source block(s) remain unsolved`)
    const output = new Uint8Array(fileSize)
    let offset = 0
    for (let index = 0; index < this.blockCount; index += 1) {
      const block = this.known.get(index)!
      const length = Math.min(block.byteLength, output.byteLength - offset)
      output.set(block.subarray(0, length), offset)
      offset += length
    }
    return output
  }
}
