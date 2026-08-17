const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)

let value = 1
for (let index = 0; index < 255; index += 1) {
  EXP[index] = value
  LOG[value] = index
  value <<= 1
  if ((value & 0x100) !== 0) value ^= 0x11d
}
for (let index = 255; index < EXP.length; index += 1) EXP[index] = EXP[index - 255]

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function inverse(valueToInvert: number): number {
  if (valueToInvert === 0) throw new Error('Singular Reed–Solomon matrix')
  return EXP[255 - LOG[valueToInvert]]
}

function invertMatrix(input: number[][]): number[][] {
  const size = input.length
  const work = input.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0)),
  ])

  for (let column = 0; column < size; column += 1) {
    let pivot = column
    while (pivot < size && work[pivot][column] === 0) pivot += 1
    if (pivot === size) throw new Error('Not enough independent shards to recover data')
    ;[work[column], work[pivot]] = [work[pivot], work[column]]

    const factor = inverse(work[column][column])
    for (let index = 0; index < size * 2; index += 1) {
      work[column][index] = multiply(work[column][index], factor)
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column || work[row][column] === 0) continue
      const rowFactor = work[row][column]
      for (let index = 0; index < size * 2; index += 1) {
        work[row][index] ^= multiply(rowFactor, work[column][index])
      }
    }
  }
  return work.map((row) => row.slice(size))
}

function vandermonde(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      if (column === 0) return 1
      if (row === 0) return 0
      return EXP[(LOG[row] * column) % 255]
    }),
  )
}

function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    right[0].map((_, column) =>
      row.reduce((result, valueAtIndex, index) => result ^ multiply(valueAtIndex, right[index][column]), 0),
    ),
  )
}

export function generatorMatrix(dataShards: number, parityShards: number): number[][] {
  if (dataShards < 1 || dataShards + parityShards > 255) throw new Error('Invalid shard count')
  const matrix = vandermonde(dataShards + parityShards, dataShards)
  return multiplyMatrices(matrix, invertMatrix(matrix.slice(0, dataShards)))
}

function combine(row: number[], shards: Uint8Array[], shardSize: number): Uint8Array {
  const output = new Uint8Array(shardSize)
  for (let shard = 0; shard < row.length; shard += 1) {
    const coefficient = row[shard]
    if (coefficient === 0) continue
    for (let byte = 0; byte < shardSize; byte += 1) {
      output[byte] ^= multiply(coefficient, shards[shard][byte])
    }
  }
  return output
}

export function createParity(data: Uint8Array[], parityShards: number): Uint8Array[] {
  if (data.length === 0 || parityShards === 0) return []
  const shardSize = data[0].byteLength
  if (data.some((shard) => shard.byteLength !== shardSize)) throw new Error('All shards must be equal size')
  const matrix = generatorMatrix(data.length, parityShards)
  return matrix.slice(data.length).map((row) => combine(row, data, shardSize))
}

export function recoverData(
  shards: Array<Uint8Array | undefined>,
  dataShards: number,
  parityShards: number,
): Uint8Array[] {
  if (shards.length !== dataShards + parityShards) throw new Error('Shard array has an invalid length')
  const available = shards
    .map((shard, index) => ({ shard, index }))
    .filter((entry): entry is { shard: Uint8Array; index: number } => entry.shard !== undefined)
  if (available.length < dataShards) throw new Error('Not enough shards to recover data')
  const selected = available.slice(0, dataShards)
  const shardSize = selected[0].shard.byteLength
  const generator = generatorMatrix(dataShards, parityShards)
  const decodeMatrix = invertMatrix(selected.map(({ index }) => generator[index]))
  const selectedShards = selected.map(({ shard }) => shard)
  return Array.from({ length: dataShards }, (_, index) => {
    const existing = shards[index]
    return existing ?? combine(decodeMatrix[index], selectedShards, shardSize)
  })
}
