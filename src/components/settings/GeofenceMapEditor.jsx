import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polygon, Circle, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import { Search, Trash2 } from 'lucide-react'
import { searchPlace } from '../../utils/geocode'
import { inputStyle, SECONDARY_BTN } from '../../pages/settings/formStyles'

/**
 * The Geofence editor's map: draw/edit a single polygon or circle with
 * Leaflet-Geoman, search a place to jump there, and show the rest of the
 * selected BG's shapes for context.
 *
 * ── Why Geoman is driven imperatively against the raw Leaflet map ──────────
 *
 * The usual React pairing for draw tooling is react-leaflet-draw, but that
 * wrapper is pinned to old react-leaflet majors and this app is on
 * react-leaflet 5 / React 19 — there is no version of it that supports both.
 * Leaflet-Geoman has no such coupling: it attaches directly to `L.Map` and
 * `L.Layer`, so it works against whatever react-leaflet version rendered the
 * map underneath it. The editable shape is therefore a plain Leaflet layer
 * added with `L.polygon`/`L.circle` and kept in a ref, NOT a react-leaflet
 * <Polygon>/<Circle> — Geoman's edit handles mutate the layer's own latlngs
 * directly, which a react-managed element would just have overwritten on the
 * next render.
 *
 * The read-only "other shapes in this BG" layer has no such conflict, so it
 * uses ordinary react-leaflet <Polygon>/<Circle> components.
 */

const DEFAULT_CENTER = [24.4539, 54.3773] // Abu Dhabi
const DEFAULT_ZOOM = 10

function toLatLngs(points) {
  return (points ?? []).map(p => [p.lat, p.lng])
}

/** Reads a Leaflet polygon/circle layer back into the draft's own field shape. */
function layerToPatch(layer) {
  if (layer instanceof L.Circle) {
    const c = layer.getLatLng()
    return { shape: 'CIRCLE', centerLat: c.lat, centerLng: c.lng, radius: layer.getRadius() }
  }
  const latlngs = (layer.getLatLngs()[0] ?? []).map(ll => ({ lat: ll.lat, lng: ll.lng }))
  return { shape: 'POLYGON', points: latlngs }
}

/** Puts a layer into Geoman's edit mode and reports every change upward. */
function enableEditing(layer, onChange) {
  const sync = () => onChange(layerToPatch(layer))
  layer.on('pm:edit pm:dragend pm:markerdragend pm:vertexadded pm:vertexremoved', sync)
  layer.pm.enable({ allowSelfIntersection: false })
}

/**
 * The single editable layer. No visual output of its own — it drives the map
 * imperatively and reports geometry changes upward via onChange.
 *
 * Rebuilt from `shape`/`points`/`center`/`radius` only when the shape KIND
 * changes (POLYGON ↔ CIRCLE) or `resetKey` changes (switching which geofence
 * is being edited) — not on every coordinate, which would mean every drag
 * event re-creates the layer out from under the user's own edit gesture.
 */
function EditableShape({ map, shape, points, centerLat, centerLng, radius, color, resetKey, onChange }) {
  const layerRef = useRef(null)

  // Draw toolbar + "a shape was just drawn from scratch" — mounted once per map.
  useEffect(() => {
    if (!map) return

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false, drawCircleMarker: false, drawPolyline: false,
      drawRectangle: false, drawText: false,
      drawPolygon: true, drawCircle: true,
      editMode: false, dragMode: false, cutPolygon: false, removalMode: false,
      rotateMode: false,
    })

    const onCreate = e => {
      // A fresh shape replaces whatever was being edited — one editable
      // geofence per form, same as every other Settings record.
      if (layerRef.current) map.removeLayer(layerRef.current)
      layerRef.current = e.layer
      enableEditing(e.layer, onChange)
      onChange(layerToPatch(e.layer))
    }
    map.on('pm:create', onCreate)

    return () => {
      map.off('pm:create', onCreate)
      map.pm.removeControls()
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // (Re)build the editable layer from the draft's own geometry whenever the
  // shape kind changes or a different geofence is loaded into the form.
  useEffect(() => {
    if (!map) return
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    let layer = null
    if (shape === 'POLYGON' && Array.isArray(points) && points.length >= 3) {
      layer = L.polygon(toLatLngs(points), { color, weight: 2, fillOpacity: 0.18 })
    } else if (shape === 'CIRCLE' && centerLat != null && centerLng != null && radius) {
      layer = L.circle([centerLat, centerLng], { radius, color, weight: 2, fillOpacity: 0.18 })
    }
    if (!layer) return

    layer.addTo(map)
    enableEditing(layer, onChange)
    layerRef.current = layer

    try {
      map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 16 })
    } catch { /* a brand-new circle with no prior geometry has no bounds yet */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, shape, resetKey])

  return null
}

function ContextShapes({ geofences, activeId }) {
  return (
    <>
      {geofences
        .filter(g => g.id !== activeId)
        .map(g => {
          const color = g.color || '#6b7280'
          const pathOptions = { color, weight: 1.5, dashArray: '4 4', fillOpacity: 0.06 }
          if (g.shape === 'POLYGON' && Array.isArray(g.points) && g.points.length >= 3) {
            return (
              <Polygon key={g.id} positions={toLatLngs(g.points)} pathOptions={pathOptions}>
                <Tooltip sticky>{g.name}</Tooltip>
              </Polygon>
            )
          }
          if (g.shape === 'CIRCLE' && g.centerLat != null && g.centerLng != null && g.radius) {
            return (
              <Circle
                key={g.id}
                center={[g.centerLat, g.centerLng]}
                radius={g.radius}
                pathOptions={pathOptions}
              >
                <Tooltip sticky>{g.name}</Tooltip>
              </Circle>
            )
          }
          return null
        })}
    </>
  )
}

/**
 * @param draft      the form's current { shape, points, centerLat, centerLng, radius, color }
 * @param onChange   patch callback — same shape set() the form already uses
 * @param contextGeofences  the selected BG's other geofences, read-only backdrop
 * @param resetKey   changes when the form switches to editing a different record
 */
export default function GeofenceMapEditor({ draft, onChange, contextGeofences = [], resetKey }) {
  const [map, setMap] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  // Bumped on "Delete shape" so EditableShape's rebuild effect re-runs even
  // though shape/resetKey themselves did not change — that effect is what
  // actually removes the Leaflet layer from the map.
  const [clearTick, setClearTick] = useState(0)

  const runSearch = async e => {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      setResults(await searchPlace(q))
    } finally {
      setSearching(false)
    }
  }

  const pickResult = r => {
    setResults([])
    setQuery(r.label)
    map?.flyTo([r.lat, r.lng], 15)
  }

  const clearShape = () => {
    onChange({ points: [], centerLat: null, centerLng: null })
    setClearTick(t => t + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* A <div>, not a <form> — this whole editor lives inside the page's own
            <form onSubmit={submit}>, and a nested <form> is invalid HTML whose
            browser-assigned submit behavior (Enter in the input, or a
            type="submit" button with no closer ancestor) would bubble up to
            that outer form instead of running the search. Enter is wired by
            hand below for the same reason. */}
        <div style={{ display: 'flex', gap: 6, flex: '1 1 260px', position: 'relative' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch()
              }
            }}
            placeholder="Search a place or address to jump the map there"
            style={inputStyle(false)}
          />
          <button type="button" onClick={runSearch} style={SECONDARY_BTN} disabled={searching} title="Search">
            <Search size={14} />
          </button>
          {results.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 1000,
              background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 8,
              boxShadow: '0 8px 20px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
            }}>
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickResult(r)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                    fontSize: 11.5, background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--c-text2)', borderBottom: '1px solid var(--c-border2)',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" style={SECONDARY_BTN} onClick={clearShape} title="Delete the drawn shape">
          <Trash2 size={13} />
          Delete shape
        </button>
      </div>

      <div style={{
        height: 420, borderRadius: 'var(--ft-radius-inner)', overflow: 'hidden',
        border: '1px solid var(--c-border2)',
      }}>
        <MapContainer
          ref={setMap}
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <ContextShapes geofences={contextGeofences} activeId={draft.id} />

          {map && (
            <EditableShape
              map={map}
              shape={draft.shape}
              points={draft.points}
              centerLat={draft.centerLat}
              centerLng={draft.centerLng}
              radius={draft.radius}
              color={draft.color || '#2563eb'}
              resetKey={`${resetKey ?? ''}:${clearTick}`}
              onChange={onChange}
            />
          )}
        </MapContainer>
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--c-text3)', margin: 0 }}>
        Use the polygon or circle tool (top-left on the map) to draw a shape, drag its handles to
        reshape it, or Delete shape and start over. Dashed shapes are this BG's other geofences,
        shown for context.
      </p>
    </div>
  )
}
