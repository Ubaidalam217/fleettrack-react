import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { HEAT_STOPS } from '../../utils/heatmap'

/**
 * A heat map drawn on its own canvas over the map tiles (Heat Map report).
 *
 * Written here rather than pulled in from leaflet.heat: its only release that
 * fits Leaflet 1.9 came out days ago, and the drawing is small — the classic
 * "simpleheat" way: every place is a soft grey blot whose darkness is its
 * weight, and the stacked darkness is then coloured from blue (little) to red
 * (most).
 *
 * On every draw the places are first summed into screen squares half a blot
 * wide, as leaflet.heat does: zoomed out, thousands of places fall on the same
 * few pixels, and drawn one by one they stack into a solid red smear. The
 * squares' weights go through a square root and the top 2% are clipped, so one
 * depot does not wash every other place out to blue.
 *
 * points: [{ lat, lng, weight }]
 */

const MIN_ALPHA = 0.08

function palette() {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 256
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  for (const [at, color] of HEAT_STOPS) g.addColorStop(at, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1, 256)
  return ctx.getImageData(0, 0, 1, 256).data
}

/** A blurred dot, drawn by its shadow so the edge fades out. */
function blot(r, blur) {
  const c = document.createElement('canvas')
  const r2 = r + blur
  c.width = c.height = r2 * 2
  const ctx = c.getContext('2d')
  ctx.shadowOffsetX = ctx.shadowOffsetY = r2 * 2
  ctx.shadowBlur = blur
  ctx.shadowColor = 'black'
  ctx.beginPath()
  ctx.arc(-r2, -r2, r, 0, Math.PI * 2, true)
  ctx.closePath()
  ctx.fill()
  return c
}

/** Bigger blots as you zoom in, so a street stays a line rather than dots. */
const radiusAt = zoom => Math.max(10, Math.min(30, 10 + (zoom - 10) * 3))

const HeatCanvas = L.Layer.extend({
  initialize() {
    this._points = []
  },

  onAdd(map) {
    this._map = map
    this._canvas = L.DomUtil.create('canvas', 'leaflet-layer')
    this._canvas.style.pointerEvents = 'none'
    map.getPanes().overlayPane.appendChild(this._canvas)
    this._palette = palette()
    map.on('moveend zoomend resize viewreset', this._reset, this)
    // The canvas does not follow Leaflet's zoom animation; hide it until it settles.
    map.on('zoomstart', this._hide, this)
    this._reset()
  },

  onRemove(map) {
    map.off('moveend zoomend resize viewreset', this._reset, this)
    map.off('zoomstart', this._hide, this)
    this._canvas.remove()
  },

  setData(points) {
    this._points = points
    if (this._map) this._draw()
  },

  _hide() { if (this._canvas) this._canvas.style.visibility = 'hidden' },

  _reset() {
    const size = this._map.getSize()
    this._canvas.width = size.x
    this._canvas.height = size.y
    L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]))
    this._canvas.style.visibility = ''
    this._draw()
  },

  _draw() {
    const { width, height } = this._canvas
    const ctx = this._canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, width, height)
    if (!this._points.length || !width || !height) return
    const r = radiusAt(this._map.getZoom())
    const blur = Math.round(r * 0.85)
    const dot = blot(r, blur)
    const r2 = r + blur

    // Sum the places on screen into squares; each square sits at its weighted centre.
    const size = Math.max(2, Math.round(r / 2))
    const grid = new Map()
    for (const p of this._points) {
      const at = this._map.latLngToContainerPoint([p.lat, p.lng])
      if (at.x < -r2 || at.y < -r2 || at.x > width + r2 || at.y > height + r2) continue
      const key = `${Math.floor(at.x / size)}:${Math.floor(at.y / size)}`
      const g = grid.get(key)
      if (g) { g.x += at.x * p.weight; g.y += at.y * p.weight; g.w += p.weight }
      else grid.set(key, { x: at.x * p.weight, y: at.y * p.weight, w: p.weight })
    }
    const squares = [...grid.values()].filter(g => g.w > 0)
    // The 98th percentile, not the very top, sets "red".
    const sorted = squares.map(g => Math.sqrt(g.w)).sort((a, b) => a - b)
    const max = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] || 1 : 1
    for (const g of squares) {
      ctx.globalAlpha = Math.min(1, Math.max(MIN_ALPHA, Math.sqrt(g.w) / max))
      ctx.drawImage(dot, g.x / g.w - r2, g.y / g.w - r2)
    }
    ctx.globalAlpha = 1
    const img = ctx.getImageData(0, 0, width, height)
    const d = img.data
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]
      if (!a) continue
      const j = a * 4
      d[i - 3] = this._palette[j]
      d[i - 2] = this._palette[j + 1]
      d[i - 1] = this._palette[j + 2]
      d[i] = Math.min(235, a + 40) // a little more body, never fully opaque
    }
    ctx.putImageData(img, 0, 0)
  },
})

export default function HeatLayer({ points }) {
  const map = useMap()
  const layer = useRef(null)
  useEffect(() => {
    const l = new HeatCanvas()
    l.addTo(map)
    layer.current = l
    return () => { l.remove(); layer.current = null }
  }, [map])
  useEffect(() => { layer.current?.setData(points ?? []) }, [points])
  return null
}
