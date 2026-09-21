// One-off asset preparation: decode the stock vehicle art in public/logo and
// emit trimmed, transparent, north-facing square PNGs into public/vehicles.
//
// Why a browser and not sharp: the sources are AVIF, which needs libheif to
// decode. Chromium already ships that decoder and a copy is cached on this
// machine, so this costs nothing at install time — and the output is
// checked-in static art, so the pipeline never has to run again.
//
// Three passes, in order:
//   1. crop   — the VectorStock watermark bar is real pixels along the bottom
//               of both files and would otherwise land in the trim bbox.
//   2. key    — flood fill from the border, NOT a global colour threshold. The
//               sedan's body is a very light grey barely 20 units off white;
//               thresholding on "near white" would eat the car with its
//               backdrop. A flood is blocked by the vehicle's darker outline,
//               so it only ever removes what is actually connected to the edge.
//   3. rotate — the markers spin by compass heading, so every vehicle has to
//               rest pointing north. The sedan ships pointing east.

// Not part of the build and not an npm script: run it by hand, only when new
// source art lands in public/logo. It needs playwright-core and a Chromium
// binary, neither of which is a dependency of this project — set PW_CORE and
// PW_CHROME to point at whatever copy the machine already has:
//
//   PW_CORE=<path/to/playwright-core> PW_CHROME=<path/to/chrome.exe> \
//     node scripts/prep-vehicles.mjs

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from 'node:process'

const require = createRequire(import.meta.url)
const { chromium } = require(env.PW_CORE || 'playwright-core')

const CHROME = env.PW_CHROME || undefined   // undefined: let playwright find it
const ROOT   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC    = path.join(ROOT, 'public', 'logo')
const OUT    = path.join(ROOT, 'public', 'vehicles')
const SIZE   = 256

const JOBS = [
  {
    out: 'sedan.png',
    src: 'silver-sedan-top-view-vector-20532416.avif',
    crop: { w: 1000, h: 596 },   // 1000x689; watermark band starts at y=600
    rotate: -90,                 // ships nose-east
    tol: [42, 88],
  },
  {
    out: 'truck.png',
    src: 'red-truck-top-view-vector-61128096.avif',
    crop: { w: 700, h: 980 },    // 700x1080; watermark band starts at y=990
    rotate: 0,                   // already nose-north
    // Wider band: this render has a soft grey drop shadow down its left flank,
    // and the default ramp leaves a visible halo once the art is on a map tile.
    tol: [62, 128],
  },
]

const MIME = { '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg' }

function dataUrl(file) {
  const ext = path.extname(file).toLowerCase()
  return `data:${MIME[ext]};base64,${readFileSync(path.join(SRC, file)).toString('base64')}`
}

// Runs inside the page. Returns a base64 PNG, or null if the image would not
// decode — an AVIF profile Chromium refuses is a hard stop, not a silent pass.
async function process({ url, size, crop, rotate, tol }) {
  const img = new Image()
  img.src = url
  try { await img.decode() } catch { return null }

  const w = crop?.w ?? img.naturalWidth
  const h = crop?.h ?? img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, crop?.x ?? 0, crop?.y ?? 0, w, h, 0, 0, w, h)

  const id = ctx.getImageData(0, 0, w, h)
  const px = id.data
  const at = (x, y) => (y * w + x) * 4

  // The backdrop is whatever the corners agree on. Sampling all four and
  // averaging survives the faint gradients these stock renders ship with.
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
  let br = 0, bg = 0, bb = 0, ba = 0
  for (const [x, y] of corners) {
    const i = at(x, y)
    br += px[i]; bg += px[i + 1]; bb += px[i + 2]; ba += px[i + 3]
  }
  br /= 4; bg /= 4; bb /= 4; ba /= 4

  if (ba >= 16) {   // below that it is already cut out and only needs trimming
    const [TOL_HARD, TOL_SOFT] = tol
    const seen  = new Uint8Array(w * h)
    const stack = []
    for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1)
    for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y)

    while (stack.length) {
      const y = stack.pop(), x = stack.pop()
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const p = y * w + x
      if (seen[p]) continue
      const i = p * 4
      const dr = px[i] - br, dg = px[i + 1] - bg, db = px[i + 2] - bb
      const d = Math.sqrt(dr * dr + dg * dg + db * db)
      if (d >= TOL_SOFT) continue
      seen[p] = 1
      // Alpha ramps 0 -> 255 across the soft band, so the silhouette keeps the
      // source's anti-aliasing instead of gaining a hard jaggy rim.
      px[i + 3] = d <= TOL_HARD ? 0 : Math.round(((d - TOL_HARD) / (TOL_SOFT - TOL_HARD)) * 255)
      // Only fully-cleared pixels spread; a half-lit rim pixel is the boundary.
      if (px[i + 3] === 0) stack.push(x - 1, y, x + 1, y, x, y - 1, x, y + 1)
    }
    ctx.putImageData(id, 0, 0)
  }

  // Trim to the ink, so a 42px marker spends all 42px on the vehicle rather
  // than on the generous margins every one of these files ships with.
  const cut = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cut[at(x, y) + 3] > 12) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null

  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  // Post-rotation extent is what has to fit the square box.
  const swap = Math.abs(rotate) === 90
  const fitW = swap ? bh : bw
  const fitH = swap ? bw : bh
  const pad  = 0.03                       // keeps the drop shadow off the edge
  const scale = (size * (1 - pad * 2)) / Math.max(fitW, fitH)

  const outC = document.createElement('canvas')
  outC.width = size; outC.height = size
  const octx = outC.getContext('2d')
  octx.imageSmoothingQuality = 'high'
  octx.translate(size / 2, size / 2)
  if (rotate) octx.rotate((rotate * Math.PI) / 180)
  octx.drawImage(c, x0, y0, bw, bh, -bw * scale / 2, -bh * scale / 2, bw * scale, bh * scale)

  return { png: outC.toDataURL('image/png').split(',')[1], w: bw, h: bh }
}

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})
const page    = await browser.newPage()
await page.setContent('<html><body></body></html>')

mkdirSync(OUT, { recursive: true })
for (const job of JOBS) {
  const res = await page.evaluate(process, {
    url: dataUrl(job.src), size: SIZE, crop: job.crop, rotate: job.rotate, tol: job.tol,
  })
  if (!res) { console.log(`FAIL  ${job.out}  <- ${job.src}`); continue }
  writeFileSync(path.join(OUT, job.out), Buffer.from(res.png, 'base64'))
  console.log(`ok    ${job.out}  <- ${job.src}  (ink ${res.w}x${res.h} -> ${SIZE}x${SIZE})`)
}
await browser.close()
