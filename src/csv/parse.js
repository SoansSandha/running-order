/**
 * CSV text into a rectangular grid of strings.
 *
 * Pure module: no network, no browser APIs. See docs design §7.1.
 *
 * PapaParse handles the awkward parts — quoted delimiters, escaped quotes,
 * mixed line endings, delimiter sniffing. This wrapper adds the two things it
 * does not do for us: BOM removal, and padding short rows so column indexing
 * never reads undefined.
 */

import Papa from 'papaparse'

export function parseCsv(text) {
  const cleaned = stripByteOrderMark(String(text ?? ''))
  if (!cleaned.trim()) return { rows: [], errors: [] }

  const result = Papa.parse(cleaned, { skipEmptyLines: true, header: false })
  const data = result.data ?? []
  const width = data.reduce((widest, row) => Math.max(widest, row.length), 0)

  const rows = data.map((row) => {
    const cells = row.map((cell) => (typeof cell === 'string' ? cell.trim() : ''))
    while (cells.length < width) cells.push('')
    return cells
  })

  return { rows, errors: result.errors ?? [] }
}

/**
 * Excel writes a BOM on UTF-8 exports. Left in place it corrupts the first
 * header, and column detection then fails on an otherwise valid file.
 */
function stripByteOrderMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
