export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

/**
 * Spreadsheet apps execute cells that start with = + - @ as formulas, which makes
 * exported user data (client names, notes, ...) an injection vector. Prefix such
 * cells with an apostrophe so they are always treated as text.
 */
function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return ''
  let text = String(raw)
  if (typeof raw === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => escapeCell(c.value(row))).join(','))
  return lines.join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 (names with accents, ₹) correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
