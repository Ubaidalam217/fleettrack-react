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
import { dateBarColor, dateLabelEvery } from './dateBarColors'

export const CTRACK_RED = [139, 0, 0]
export const CTRACK_ZEBRA = [228, 228, 247]
const GREY = [120, 120, 120]
const M = 12 // page margin

const PAGE = {
  landscape: { w: 841.89, h: 595.28 },
  portrait: { w: 595.28, h: 841.89 },
}
const BAR_TRACK = [214, 214, 214]
const BAR_FILL = [31, 160, 31]
/** Line colours of a line chart's series, in order (the Violation Overview's "By Occurrence"). */
export const CTRACK_LINE_COLORS = [
  [56, 168, 196], [220, 38, 72], [76, 175, 80], [214, 154, 0], [232, 106, 46], [150, 40, 40], [72, 136, 152], [222, 85, 110],
  [96, 178, 104], [230, 170, 0], [110, 170, 210], [232, 120, 140], [130, 196, 140], [235, 140, 60], [200, 90, 90], [156, 200, 220],
  [240, 170, 180], [180, 220, 180], [120, 90, 170], [90, 90, 90],
]
const argbOf = ([r, g, b]) => ({ argb: `FF${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}` })

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
 *
 * Optional, for the samples laid out differently (Violation Overview,
 * Utilization Details, Power Failure — client, 2026-11-13); left out, the
 * report draws as above:
 *   pageSize {w, h} in pt (the sample's own page size), fontSize, titleSize,
 *   headerRuleY (the rule under the title), rowPad (a row's height over its text),
 *   pairsPerLine, pairCols [{x, vx}] (label / value x from the margin), pairLineH,
 *   pairTop (the first line's distance from the rule);
 *   per table: newPage, fit / indent (shares of the usable width), headingColor,
 *     headingSize, headColor, zebra (false: none), zebraStart, ruleAbove,
 *     valign 'top'; or kind 'lineChart' { title, yLabel, xLabel, labels,
 *     series: [{name, values}] }: a line chart on a page of its own;
 *   per column: headColor, bold, color, type 'bar' (the row's value 0..1, drawn
 *     as a green share on a grey track);
 *   summaryTable: a table under the summary title, after any summary lines.
 */
export async function buildCtrackPdf(o) {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogo()])
  const P = o.pageSize ?? PAGE[o.orientation ?? 'landscape']
  const orientation = o.pageSize ? (P.w > P.h ? 'landscape' : 'portrait') : (o.orientation ?? 'landscape')
  const doc = new jsPDF({ orientation, unit: 'pt', format: o.pageSize ? [P.w, P.h] : 'a4' })
  const usable = P.w - 2 * M
  const BOTTOM = P.h - 34
  let y = 0
  let first = true

  // headerRuleY: where the rule under the title sits (52); a deeper band moves the logo and title down with it.
  const ruleY = o.headerRuleY ?? 52
  const band = ruleY - 52
  const chrome = ({ withBlock }) => {
    if (logo) doc.addImage(logo, 'JPEG', M + 2, 14 + band * 0.65, 64, 64 * (273 / 863), 'fleetmax-logo', 'FAST')
    else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(10, 143, 176)
      doc.text('FleetmaxX', M + 2, 28 + band * 0.65)
    }
    doc.setFont('times', 'bold'); doc.setFontSize(o.titleSize ?? 17); doc.setTextColor(0, 0, 0)
    doc.text(str(o.title), P.w / 2, 34 + band * 0.4, { align: 'center' })
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.3)
    doc.line(M, ruleY, P.w - M, ruleY)
    y = ruleY
    if (!withBlock) { y += 12; return }
    const pairs = o.pairs ?? []
    const per = o.pairsPerLine ?? 2
    doc.setFontSize(o.fontSize ?? 8)
    for (let i = 0; i < pairs.length; i += per) {
      y += i === 0 && o.pairTop ? o.pairTop : (o.pairLineH ?? 15)
      pairs.slice(i, i + per).forEach((p, j) => {
        if (!p) return
        const at = o.pairCols?.[j]
        const x = M + (at ? at.x : 4 + j * 165)
        doc.setFont('times', 'bold'); doc.text(`${p[0]}:`, x, y)
        // A label longer than the usual offset ("Grouped By Entity:") pushes its value along.
        const off = at ? at.vx - at.x : Math.max(j ? 70 : 38, doc.getTextWidth(`${p[0]}:`) + 8)
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
  const fs = o.fontSize ?? 7.6
  const lineH = o.fontSize ? fs * 1.13 : 8.6
  let zebra = o.zebraStart ?? true

  const drawTable = table => {
    if (table.newPage) newPage(false)
    const x0 = M + 2 + (table.indent ?? 0) * (usable - 4)
    const tw = (table.fit ?? 1) * (usable - 4)
    const cols = layout(table.columns, x0, tw)
    doc.setFont('times', 'bold'); doc.setFontSize(fs)
    const headLines = cols.map(c => cellLines(doc, c.label, c.w))
    const headH = Math.max(...headLines.map(l => l.length)) * lineH + 5
    const headingFs = table.headingSize ?? 8.6
    const headingH = table.heading ? headingFs + 7.4 : 0
    const zebraStart = table.zebraStart ?? o.zebraStart ?? true

    const drawHead = () => {
      if (table.heading) {
        doc.setFont('times', table.headingItalic ? 'bolditalic' : 'bold'); doc.setFontSize(headingFs); doc.setTextColor(...(table.headingColor ?? CTRACK_RED))
        doc.text(str(table.heading), x0 + 2, y + headingFs + 1.4)
        y += headingH
      }
      if (table.ruleAbove) {
        doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.6)
        doc.line(x0, y, x0 + tw, y)
        y += 2
      }
      doc.setFont('times', 'bold'); doc.setFontSize(fs)
      // Labels sit on the rule, bottom-aligned like the sample.
      cols.forEach((c, i) => {
        doc.setTextColor(...(c.headColor ?? table.headColor ?? [0, 0, 0]))
        drawLines(doc, headLines[i], c, y + headH - 3 - headLines[i].length * lineH - 1, lineH, fs)
      })
      y += headH
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(1)
      doc.line(x0, y, x0 + tw, y)
      y += 1
    }
    if (y + headingH + headH + 14 > BOTTOM) newPage(false)
    drawHead()

    if (!o.zebraContinue) zebra = zebraStart
    for (const row of table.rows) {
      if (row.kind === 'band') continue
      doc.setFontSize(fs)
      const lines = cols.map(c => {
        if (c.icon || c.type === 'bar') return ['']
        doc.setFont('times', row.strong || c.bold ? 'bold' : 'normal')
        return cellLines(doc, row[c.key], c.w)
      })
      const n = Math.max(...lines.map(l => l.length))
      const rowH = Math.max(n * lineH + (o.rowPad ?? 4), cols.some(c => c.icon) ? 15 : 0)
      if (y + rowH > BOTTOM) {
        newPage(false)
        drawHead()
        if (!o.zebraContinue) zebra = zebraStart
      }
      if (!row.strong && zebra && table.zebra !== false) {
        doc.setFillColor(...CTRACK_ZEBRA)
        doc.rect(x0, y, tw, rowH, 'F')
      }
      if (!row.strong) zebra = !zebra
      const top = table.valign === 'top' ? y + 1 : y + (rowH - n * lineH) / 2 - 1
      cols.forEach((c, i) => {
        if (c.icon === 'map') {
          if (row[c.hrefKey] || row.mapUrl) {
            drawMapIcon(doc, c.x + c.w / 2, y, rowH)
            const href = row[c.hrefKey] || row.mapUrl
            if (href) doc.link(c.x, y, c.w, rowH, { url: href })
          }
          return
        }
        if (c.type === 'bar') {
          const v = row[c.key]
          if (v == null || !Number.isFinite(Number(v))) return
          const bw = Math.min(c.w - 8, 62)
          const by = table.valign === 'top' ? y + 4 : y + rowH / 2 - 2.5
          doc.setFillColor(...BAR_TRACK); doc.rect(c.x + 4, by, bw, 5, 'F')
          const f = Math.max(0, Math.min(1, Number(v)))
          if (f > 0) { doc.setFillColor(...BAR_FILL); doc.rect(c.x + 4, by, Math.max(1, bw * f), 5, 'F') }
          return
        }
        doc.setFont('times', row.strong || c.bold ? 'bold' : 'normal')
        doc.setTextColor(...(row.strong ? CTRACK_RED : c.color ?? [0, 0, 0]))
        const cell = row.cellAlign?.[c.key] ? { ...c, align: row.cellAlign[c.key] } : c
        const off = table.valign === 'top' ? 0 : (n - lines[i].length) * lineH / 2
        drawLines(doc, lines[i], cell, top + off, lineH, fs)
      })
      y += rowH
    }
    y += 6
  }

  for (const table of o.tables ?? []) {
    if (table.kind === 'lineChart') {
      newPage(false)
      y = drawLineChart(doc, { x: M + 62, y: y + 6, w: usable - 92, h: Math.min(230, (BOTTOM - y) * 0.42), chart: table })
    } else drawTable(table)
  }

  if (o.chart?.length) {
    // The two graphs one under the other, each with its date legend (client's
    // Ctrack image, 2026-11-13); the second moves to a new page if it can't fit.
    newPage(false)
    const graphs = [
      { title: 'Distance Driven Graph', data: o.chart.map(d => ({ label: d.date ?? d.day, v: d.total })) },
      { title: 'Average Distance Driven per Asset', data: o.chart.map(d => ({ label: d.date ?? d.day, v: d.avg })) },
    ]
    graphs.forEach((g, k) => {
      const h = 150
      if (k > 0 && y + barChartHeight(g.data.length, h) > BOTTOM) newPage(false)
      y = drawBarChart(doc, { x: M + 58, y: y + 10, w: usable - 72, h, title: g.title, data: g.data }) + 16
    })
  }

  if (o.summary?.length || o.summaryTable) {
    newPage(false)
    doc.setTextColor(...CTRACK_RED)
    doc.setFont('times', 'bold'); doc.setFontSize(o.fontSize ? fs + 1.8 : 10.5)
    doc.text(str(o.summaryTitle ?? 'Report Summary'), M + 4, y + 8)
    y += 26
    doc.setFontSize(o.fontSize ?? 8.6)
    for (const { label, value } of o.summary ?? []) {
      doc.text(str(label), M + 4, y)
      doc.text(str(value), M + 135, y)
      y += 16
    }
    if (o.summaryTable) {
      y -= 12
      drawTable(o.summaryTable)
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

const LEGEND_PER_ROW = 8
const LEGEND_ROW_H = 11

/** Height drawBarChart takes for n dates and a plot h high, legend included. */
function barChartHeight(n, h) {
  return 14 + h + 40 + Math.ceil(n / LEGEND_PER_ROW) * LEGEND_ROW_H + 10
}

/**
 * A Distance Driven graph like the client's Ctrack image (2026-11-13): a thin
 * bar per date in its own colour (utils/dateBarColors.js), light grid, every
 * other date labelled on two alternating rows, and a boxed legend of every
 * date underneath, eight to a row. Returns the y below the legend.
 */
function drawBarChart(doc, { x, y, w, h, title, data }) {
  const n = data.length
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
  doc.text(title, x + w / 2, y + 8, { align: 'center' })
  const top = y + 14
  const { top: yTop, step } = niceAxis(Math.max(0, ...data.map(d => d.v)))
  const slot = w / Math.max(1, n)
  const cx = i => x + slot * i + slot / 2
  const every = dateLabelEvery(n)

  // Grid: horizontal at each step, vertical at each labelled date.
  doc.setDrawColor(222, 222, 222); doc.setLineWidth(0.4)
  for (let v = 0; v <= yTop; v += step) {
    const gy = top + h - (h * v) / yTop
    doc.line(x, gy, x + w, gy)
  }
  for (let i = 0; i < n; i += every) doc.line(cx(i), top, cx(i), top + h)
  doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.6)
  doc.rect(x, top, w, h)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(60, 60, 60)
  for (let v = 0; v <= yTop; v += step) doc.text(String(v), x - 4, top + h - (h * v) / yTop + 2, { align: 'right' })

  const bw = Math.max(1.2, Math.min(3.2, slot * 0.18))
  data.forEach((d, i) => {
    const bh = (h * Math.max(0, d.v)) / yTop
    doc.setFillColor(...dateBarColor(i))
    if (bh > 0) doc.rect(cx(i) - bw / 2, top + h - bh, bw, bh, 'F')
  })

  // Dates: every other one, the upper and lower rows taking turns.
  doc.setFontSize(6); doc.setTextColor(40, 40, 40)
  doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.5)
  for (let i = 0; i < n; i += every) {
    const upper = (i / every) % 2 === 1
    doc.line(cx(i), top + h, cx(i), top + h + 2.5)
    doc.text(str(data[i].label), cx(i), top + h + (upper ? 9 : 17), { align: 'center' })
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 0, 0)
  doc.text('Date', x + w / 2, top + h + 29, { align: 'center' })
  const yl = 'Distance Driven (km)'
  doc.text(yl, x - 34, top + h / 2 + doc.getTextWidth(yl) / 2, { angle: 90 })

  // Legend: every date with its colour, eight to a row, in a light box.
  const lx = x + 6, lw = w - 12
  const lTop = top + h + 38
  const rows = Math.ceil(n / LEGEND_PER_ROW)
  doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.5)
  if (n) doc.rect(lx, lTop, lw, rows * LEGEND_ROW_H + 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(40, 40, 40)
  data.forEach((d, i) => {
    const colX = lx + 6 + (i % LEGEND_PER_ROW) * ((lw - 8) / LEGEND_PER_ROW)
    const rowY = lTop + 4 + Math.floor(i / LEGEND_PER_ROW) * LEGEND_ROW_H
    doc.setFillColor(...dateBarColor(i))
    doc.rect(colX, rowY + 1, 11, 6.5, 'F')
    doc.text(str(d.label), colX + 14, rowY + 6.4)
  })
  return lTop + rows * LEGEND_ROW_H + 6
}

/** A round axis top and step for counts: 138 → 140 by 20. */
export function niceAxis(max) {
  const raw = Math.max(1, max) / 7
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = Math.max(1, [1, 2, 5, 10].find(s => s * mag >= raw) * mag)
  return { top: Math.max(step, Math.ceil(Math.max(1, max) / step) * step), step }
}

/**
 * The Violation Overview's "By Occurrence": one line per series over the
 * labels (days), the legend boxed underneath. Returns the y below it.
 */
function drawLineChart(doc, { x, y, w, h, chart }) {
  const labels = chart.labels ?? []
  const series = chart.series ?? []
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
  doc.text(str(chart.title), x + w / 2, y + 8, { align: 'center' })
  const top = y + 18
  const { top: yTop, step } = niceAxis(Math.max(0, ...series.flatMap(s => s.values)))
  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5)
  doc.rect(x, top, w, h)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(60, 60, 60)
  for (let v = 0; v <= yTop; v += step) {
    const gy = top + h - (h * v) / yTop
    doc.line(x, gy, x + w, gy)
    doc.text(String(v), x - 4, gy + 2, { align: 'right' })
  }
  const slot = w / Math.max(1, labels.length)
  const px = i => x + slot * i + slot / 2
  const py = v => top + h - (h * v) / yTop
  labels.forEach((l, i) => {
    if (labels.length <= 16 || i % Math.ceil(labels.length / 16) === 0) doc.text(str(l), px(i), top + h + 10, { align: 'center' })
  })
  series.forEach((s, k) => {
    const c = CTRACK_LINE_COLORS[k % CTRACK_LINE_COLORS.length]
    doc.setDrawColor(...c); doc.setFillColor(...c); doc.setLineWidth(1)
    s.values.forEach((v, i) => {
      if (i > 0) doc.line(px(i - 1), py(s.values[i - 1]), px(i), py(v))
    })
    s.values.forEach((v, i) => doc.circle(px(i), py(v), 1.5, 'F'))
  })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 0, 0)
  doc.text(str(chart.xLabel ?? 'Date'), x + w / 2, top + h + 22, { align: 'center' })
  const yl = str(chart.yLabel)
  doc.text(yl, x - 30, top + h / 2 + doc.getTextWidth(yl) / 2, { angle: 90 })

  // Legend: four to a line in a light box.
  const per = 4
  const lx = x + 20, lw = w - 40, rowH = 13
  const lTop = top + h + 34
  const rows = Math.ceil(series.length / per)
  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5)
  if (series.length) doc.rect(lx, lTop, lw, rows * rowH + 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(40, 40, 40)
  series.forEach((s, k) => {
    const c = CTRACK_LINE_COLORS[k % CTRACK_LINE_COLORS.length]
    const cx = lx + 8 + (k % per) * (lw / per)
    const cy = lTop + 10 + Math.floor(k / per) * rowH
    doc.setDrawColor(...c); doc.setFillColor(...c); doc.setLineWidth(1)
    doc.line(cx, cy - 2, cx + 12, cy - 2)
    doc.circle(cx + 6, cy - 2, 2, 'F')
    const name = doc.splitTextToSize(str(s.name), lw / per - 24)[0]
    doc.text(name, cx + 16, cy)
  })
  return lTop + rows * rowH + 20
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
  // Charts (kind 'lineChart') are left out: their numbers are in the tables.
  const sheets = [...(o.tables ?? []), ...(o.summaryTable ? [o.summaryTable] : [])].filter(t => t.columns)
  const width = Math.max(1, ...sheets.map(t => t.columns.length))
  const red = { argb: 'FF8B0000' }
  const lavender = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E4F7' } }

  const t = ws.addRow([o.title])
  t.font = { name: 'Times New Roman', bold: true, size: 16 }
  ws.mergeCells(t.number, 1, t.number, width)
  t.alignment = { horizontal: 'center' }
  const per = o.pairsPerLine ?? 2
  for (let i = 0; i < (o.pairs ?? []).length; i += per) {
    const cells = o.pairs.slice(i, i + per).flatMap(p => (p ? [`${p[0]}:`, str(p[1])] : ['', '']))
    const r = ws.addRow(cells)
    for (let j = 0; j < cells.length; j += 2) r.getCell(j + 1).font = { bold: true }
  }
  ws.addRow([])

  let zebra
  const writeTable = table => {
    const cols = table.columns
    if (table.heading) {
      const h = ws.addRow([table.heading])
      h.font = { bold: true, italic: !!table.headingItalic, color: table.headingColor ? argbOf(table.headingColor) : red }
    }
    const head = ws.addRow(cols.map(c => c.label))
    head.font = { bold: true }
    cols.forEach((c, i) => {
      const hc = c.headColor ?? table.headColor
      if (hc) head.getCell(i + 1).font = { bold: true, color: argbOf(hc) }
    })
    head.eachCell(c => { c.border = { bottom: { style: 'medium' } } })
    if (!o.zebraContinue || zebra === undefined) zebra = table.zebraStart ?? o.zebraStart ?? true
    for (const row of table.rows) {
      if (row.kind === 'band') continue
      const r = ws.addRow(cols.map(c => (
        c.icon === 'map' ? ((row[c.hrefKey] || row.mapUrl) ? 'Map' : '')
          : c.type === 'bar' ? (Number.isFinite(row[c.key]) ? `${Math.round(row[c.key] * 100)}%` : '')
            : row[c.key] ?? ''
      )))
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1)
        const own = row.cellAlign?.[c.key]
        if (own) cell.alignment = { horizontal: own }
        else if (c.align === 'right') cell.alignment = { horizontal: 'right' }
        if (c.bold || c.color) cell.font = { bold: !!c.bold, ...(c.color ? { color: argbOf(c.color) } : {}) }
        const href = c.icon === 'map' ? (row[c.hrefKey] || row.mapUrl) : null
        if (href) { cell.value = { text: 'Map', hyperlink: href }; cell.font = { color: { argb: 'FF0A7E9C' }, underline: true } }
      })
      if (row.strong) r.font = { bold: true, color: red }
      else {
        if (zebra && table.zebra !== false) r.eachCell({ includeEmpty: true }, c => { c.fill = lavender })
        zebra = !zebra
      }
    }
    ws.addRow([])
  }
  for (const table of o.tables ?? []) if (table.columns) writeTable(table)

  if (o.summary?.length || o.summaryTable) {
    const s = ws.addRow([o.summaryTitle ?? 'Report Summary'])
    s.font = { bold: true, size: 12, color: red }
    for (const { label, value } of o.summary ?? []) {
      const r = ws.addRow([label, value])
      r.font = { bold: true, color: red }
    }
    if (o.summaryTable) writeTable(o.summaryTable)
  }
  ws.addRow([])
  if (o.printDate !== '') ws.addRow([`Print Date: ${str(o.printDate)}`]).font = { italic: true, color: { argb: 'FF787878' } }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 34 : 18 })

  const buffer = await wb.xlsx.writeBuffer()
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filenameBase}_${fileStamp()}.xlsx`)
}
