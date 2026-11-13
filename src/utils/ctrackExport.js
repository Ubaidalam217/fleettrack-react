// Trip Details, Trip Locations, Trip Summary and Distance Driven — PDF/Excel
// in the layout of the client's Ctrack MaXx samples (client, 2026-11-12: "match
// those four reports exactly"), not the Movement paper the other reports use:
// logo left and a centred serif title, a From / To / Grouped By block between
// two black rules, dark-red group headings, a bold header row on a black rule,
// lavender zebra rows, dark-red summary lines, "Page X of Y" and the print date
// in the footer, and the Report Summary on a page of its own at the end.
//
// Column widths are weights, scaled to the page, as in geoZoneExport.js.
import { loadLogo, fileStamp, download } from './reportExport'

export const CTRACK_RED = [139, 0, 0]
export const CTRACK_ZEBRA = [228, 228, 247]
const GREY = [120, 120, 120]
const M = 12 // page margin

const PAGE = {
  landscape: { w: 841.89, h: 595.28 },
  portrait: { w: 595.28, h: 841.89 },
}

function layout(columns, x0, usable) {
  const total = columns.reduce((s, c) => s + (Number(c.width) || 1), 0)
  let x = x0
  return columns.map(c => {
    const w = (usable * (Number(c.width) || 1)) / total
    const col = { ...c, x, w }
    x += w
    return col
  })
}

const str = v => (v == null ? '' : String(v))

function cellLines(doc, text, w) {
  const s = str(text)
  if (!s) return ['']
  return doc.splitTextToSize(s, Math.max(4, w - 6)).slice(0, 4)
}

function drawLines(doc, lines, col, top, lineH, fs) {
  lines.forEach((ln, i) => {
    const y = top + fs + 1 + i * lineH
    if (col.align === 'right') doc.text(ln, col.x + col.w - 3, y, { align: 'right' })
    else if (col.align === 'center') doc.text(ln, col.x + col.w / 2, y, { align: 'center' })
    else doc.text(ln, col.x + 3, y)
  })
}

/** The sample's map icon: a red pin over a little green/blue map. */
function drawMapIcon(doc, cx, top, h) {
  const s = Math.min(14, h - 2)
  const y = top + (h - s) / 2
  doc.setFillColor(76, 175, 80)
  doc.triangle(cx - s * 0.55, y + s, cx, y + s * 0.62, cx + s * 0.1, y + s, 'F')
  doc.setFillColor(33, 150, 243)
  doc.triangle(cx + s * 0.1, y + s, cx, y + s * 0.62, cx + s * 0.6, y + s, 'F')
  doc.setFillColor(229, 57, 53)
  doc.circle(cx, y + s * 0.32, s * 0.3, 'F')
  doc.triangle(cx - s * 0.26, y + s * 0.42, cx + s * 0.26, y + s * 0.42, cx, y + s * 0.8, 'F')
  doc.setFillColor(255, 255, 255)
  doc.circle(cx, y + s * 0.32, s * 0.11, 'F')
}

/**
 * @param {object} o
 *   title, orientation ('landscape'|'portrait'), printDate,
 *   pairs: [[label, value]] for the From / To / Grouped By block (two per line),
 *   tables: [{ heading?, headingItalic?, columns: [{key,label,width,align?,icon?:'map',hrefKey?}], rows }],
 *   summaryTitle, summary: [{label, value}], chart?: [{day,total,avg}],
 *   zebraContinue?: the zebra runs on across tables and pages (the violation samples)
 * A row may set cellAlign: { [key]: 'left'|'center'|'right' } for its own cells.
 * A null in `pairs` leaves that half of the line empty.
 */
export async function buildCtrackPdf(o) {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogo()])
  const orientation = o.orientation ?? 'landscape'
  const P = PAGE[orientation]
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' })
  const usable = P.w - 2 * M
  const BOTTOM = P.h - 34
  let y = 0
  let first = true

  const chrome = ({ withBlock }) => {
    if (logo) doc.addImage(logo, 'JPEG', M + 2, 14, 64, 64 * (273 / 863), 'fleetmax-logo', 'FAST')
    else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(10, 143, 176)
      doc.text('FleetmaxX', M + 2, 28)
    }
    doc.setFont('times', 'bold'); doc.setFontSize(17); doc.setTextColor(0, 0, 0)
    doc.text(str(o.title), P.w / 2, 34, { align: 'center' })
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.3)
    doc.line(M, 52, P.w - M, 52)
    y = 52
    if (!withBlock) { y += 12; return }
    const pairs = o.pairs ?? []
    doc.setFontSize(8)
    for (let i = 0; i < pairs.length; i += 2) {
      y += 15
      ;[pairs[i], pairs[i + 1]].forEach((p, j) => {
        if (!p) return
        const x = M + 4 + j * 165
        doc.setFont('times', 'bold'); doc.text(`${p[0]}:`, x, y)
        // A label longer than the usual offset ("Grouped By Entity:") pushes its value along.
        const off = Math.max(j ? 70 : 38, doc.getTextWidth(`${p[0]}:`) + 8)
        doc.setFont('times', 'normal'); doc.text(str(p[1]), x + off, y)
      })
    }
    y += 9
    doc.setLineWidth(1.3)
    doc.line(M, y, P.w - M, y)
    y += 12
  }
  const newPage = withBlock => {
    if (!first) doc.addPage()
    first = false
    chrome({ withBlock })
  }

  newPage(true)
  const fs = 7.6
  const lineH = 8.6
  let zebra = o.zebraStart ?? true

  for (const table of o.tables ?? []) {
    const cols = layout(table.columns, M + 2, usable - 4)
    doc.setFont('times', 'bold'); doc.setFontSize(fs)
    const headLines = cols.map(c => cellLines(doc, c.label, c.w))
    const headH = Math.max(...headLines.map(l => l.length)) * lineH + 5
    const headingH = table.heading ? 16 : 0

    const drawHead = () => {
      if (table.heading) {
        doc.setFont('times', table.headingItalic ? 'bolditalic' : 'bold'); doc.setFontSize(8.6); doc.setTextColor(...CTRACK_RED)
        doc.text(str(table.heading), M + 4, y + 10)
        y += headingH
      }
      doc.setFont('times', 'bold'); doc.setFontSize(fs); doc.setTextColor(0, 0, 0)
      // Labels sit on the rule, bottom-aligned like the sample.
      cols.forEach((c, i) => drawLines(doc, headLines[i], c, y + headH - 3 - headLines[i].length * lineH - 1, lineH, fs))
      y += headH
      doc.setLineWidth(1)
      doc.line(M + 2, y, P.w - M - 2, y)
      y += 1
    }
    if (y + headingH + headH + 14 > BOTTOM) newPage(false)
    drawHead()

    if (!o.zebraContinue) zebra = o.zebraStart ?? true
    for (const row of table.rows) {
      if (row.kind === 'band') continue
      doc.setFont('times', row.strong ? 'bold' : 'normal'); doc.setFontSize(fs)
      const lines = cols.map(c => (c.icon ? [''] : cellLines(doc, row[c.key], c.w)))
      const n = Math.max(...lines.map(l => l.length))
      const rowH = Math.max(n * lineH + 4, cols.some(c => c.icon) ? 15 : 0)
      if (y + rowH > BOTTOM) {
        newPage(false)
        drawHead()
        if (!o.zebraContinue) zebra = o.zebraStart ?? true
      }
      if (!row.strong && zebra) {
        doc.setFillColor(...CTRACK_ZEBRA)
        doc.rect(M + 2, y, usable - 4, rowH, 'F')
      }
      if (!row.strong) zebra = !zebra
      doc.setTextColor(...(row.strong ? CTRACK_RED : [0, 0, 0]))
      const top = y + (rowH - n * lineH) / 2 - 1
      cols.forEach((c, i) => {
        if (c.icon === 'map') {
          if (row[c.hrefKey] || row.mapUrl) {
            drawMapIcon(doc, c.x + c.w / 2, y, rowH)
            const href = row[c.hrefKey] || row.mapUrl
            if (href) doc.link(c.x, y, c.w, rowH, { url: href })
          }
          return
        }
        const cell = row.cellAlign?.[c.key] ? { ...c, align: row.cellAlign[c.key] } : c
        drawLines(doc, lines[i], cell, top + (n - lines[i].length) * lineH / 2, lineH, fs)
      })
      y += rowH
    }
    y += 6
  }

  if (o.chart?.length) {
    newPage(false)
    drawBarChart(doc, { x: M + 56, y: y + 8, w: usable - 80, h: 150, title: 'Distance Driven Graph', data: o.chart.map(d => ({ label: d.day, v: d.total })) })
    drawBarChart(doc, { x: M + 56, y: y + 230, w: usable - 80, h: 150, title: 'Average Distance Driven per Asset', data: o.chart.map(d => ({ label: d.day, v: d.avg })) })
  }

  if (o.summary?.length) {
    newPage(false)
    doc.setTextColor(...CTRACK_RED)
    doc.setFont('times', 'bold'); doc.setFontSize(10.5)
    doc.text(str(o.summaryTitle ?? 'Report Summary'), M + 4, y + 8)
    y += 26
    doc.setFontSize(8.6)
    for (const { label, value } of o.summary) {
      doc.text(str(label), M + 4, y)
      doc.text(str(value), M + 135, y)
      y += 16
    }
  }

  // Footers last, so each page knows the total.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(1)
    doc.line(M, P.h - 24, P.w - M, P.h - 24)
    doc.setFont('times', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
    doc.text(`Page ${p} of ${pages}`, M + 2, P.h - 13)
    doc.text(str(o.printDate), P.w - M - 2, P.h - 13, { align: 'right' })
  }
  return doc
}

const PALETTE = [[66, 165, 199], [214, 39, 73], [76, 175, 80], [222, 158, 23], [232, 106, 46], [186, 58, 58], [86, 180, 210], [231, 88, 110]]

function drawBarChart(doc, { x, y, w, h, title, data }) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
  doc.text(title, x + w / 2, y, { align: 'center' })
  const top = y + 10
  const max = Math.max(1, ...data.map(d => d.v))
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  const nice = Math.ceil(max / step) * step
  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5)
  doc.rect(x, top, w, h)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(60, 60, 60)
  for (let i = 0; i <= 5; i++) {
    const gy = top + h - (h * i) / 5
    doc.line(x, gy, x + w, gy)
    doc.text(String(Math.round((nice * i) / 5)), x - 3, gy + 2, { align: 'right' })
  }
  const slot = w / Math.max(1, data.length)
  data.forEach((d, i) => {
    const bh = (h * d.v) / nice
    doc.setFillColor(...PALETTE[i % PALETTE.length])
    doc.rect(x + slot * i + slot * 0.3, top + h - bh, Math.max(1.2, slot * 0.4), bh, 'F')
    if (data.length <= 16 || i % 2 === 0) doc.text(d.label, x + slot * i + slot / 2, top + h + 9, { align: 'center' })
  })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 0, 0)
  doc.text('Date', x + w / 2, top + h + 21, { align: 'center' })
  const yl = 'Distance Driven (km)'
  doc.text(yl, x - 30, top + h / 2 + doc.getTextWidth(yl) / 2, { angle: 90 })
}

export async function exportCtrackPdf(o, filenameBase) {
  const doc = await buildCtrackPdf(o)
  doc.save(`${filenameBase}_${fileStamp()}.pdf`)
}

export async function exportCtrackExcel(o, filenameBase) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FleetmaxX'
  const ws = wb.addWorksheet(str(o.title).slice(0, 31) || 'Report', {
    pageSetup: { orientation: o.orientation ?? 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const width = Math.max(1, ...(o.tables ?? []).map(t => t.columns.length))
  const red = { argb: 'FF8B0000' }
  const lavender = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E4F7' } }

  const t = ws.addRow([o.title])
  t.font = { name: 'Times New Roman', bold: true, size: 16 }
  ws.mergeCells(t.number, 1, t.number, width)
  t.alignment = { horizontal: 'center' }
  for (let i = 0; i < (o.pairs ?? []).length; i += 2) {
    const a = o.pairs[i], b = o.pairs[i + 1]
    const r = ws.addRow([`${a[0]}:`, str(a[1]), b ? `${b[0]}:` : '', b ? str(b[1]) : ''])
    r.getCell(1).font = { bold: true }
    r.getCell(3).font = { bold: true }
  }
  ws.addRow([])

  let zebra
  for (const table of o.tables ?? []) {
    const cols = table.columns
    if (table.heading) {
      const h = ws.addRow([table.heading])
      h.font = { bold: true, italic: !!table.headingItalic, color: red }
    }
    const head = ws.addRow(cols.map(c => c.label))
    head.font = { bold: true }
    head.eachCell(c => { c.border = { bottom: { style: 'medium' } } })
    if (!o.zebraContinue || zebra === undefined) zebra = o.zebraStart ?? true
    for (const row of table.rows) {
      if (row.kind === 'band') continue
      const r = ws.addRow(cols.map(c => (c.icon === 'map' ? ((row[c.hrefKey] || row.mapUrl) ? 'Map' : '') : row[c.key] ?? '')))
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1)
        const own = row.cellAlign?.[c.key]
        if (own) cell.alignment = { horizontal: own }
        else if (c.align === 'right') cell.alignment = { horizontal: 'right' }
        const href = c.icon === 'map' ? (row[c.hrefKey] || row.mapUrl) : null
        if (href) { cell.value = { text: 'Map', hyperlink: href }; cell.font = { color: { argb: 'FF0A7E9C' }, underline: true } }
      })
      if (row.strong) r.font = { bold: true, color: red }
      else {
        if (zebra) r.eachCell({ includeEmpty: true }, c => { c.fill = lavender })
        zebra = !zebra
      }
    }
    ws.addRow([])
  }

  if (o.summary?.length) {
    const s = ws.addRow([o.summaryTitle ?? 'Report Summary'])
    s.font = { bold: true, size: 12, color: red }
    for (const { label, value } of o.summary) {
      const r = ws.addRow([label, value])
      r.font = { bold: true, color: red }
    }
  }
  ws.addRow([])
  ws.addRow([`Print Date: ${str(o.printDate)}`]).font = { italic: true, color: { argb: 'FF787878' } }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 34 : 18 })

  const buffer = await wb.xlsx.writeBuffer()
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filenameBase}_${fileStamp()}.xlsx`)
}
