import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { BASE_URL, HEADERS, hasFlespiToken } from '../hooks/flespiConfig'

// Only the four fields the chart reads. Flespi needs this as a COMMA-SEPARATED
// STRING — an array is a hard 400 ("#/fields: invalid type 'array', allowed only
// string") — which is why every field list in this codebase ends in .join(',').
const FIELDS = [
  // Which vehicle a message belongs to. Note `device.id`, dotted: that is what
  // REST messages carry. The MQTT payload's `device_id` does not exist here, so
  // reading it grouped all ten devices into one bucket and measured intervals
  // ACROSS vehicles.
  'device.id',
  'timestamp',
  'position.speed',
  'engine.ignition.status',
].join(',')

// Per device, matching MAX_MESSAGES in replay.js / usageData.js. Enough to cover
// a week at these devices' ~5-minute reporting rate; a device that reports faster
// is truncated, which costs the tail of the oldest day and nothing else.
const MAX_MESSAGES = 3000

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Fixed variation curve so fallback chart looks natural without Math.random
const DAY_VARIATIONS = [0.85, 0.90, 1.05, 0.95, 1.10, 0.80, 0.75]

// ── Chart data builders ────────────────────────────────────────────────────

function buildChartData(messages) {
  const now = Date.now()

  // Group by device so consecutive-message intervals stay within one vehicle.
  // `device.id` is the REST field; `device_id` is kept as a fallback because it
  // is what an MQTT payload uses, and a caller may yet pass one in.
  const byDevice = {}
  messages.forEach(m => {
    const did = m['device.id'] ?? m.device_id ?? 'unknown'
    if (!byDevice[did]) byDevice[did] = []
    byDevice[did].push(m)
  })

  const dayTotals = {}
  Object.values(byDevice).forEach(msgs => {
    msgs.sort((a, b) => a.timestamp - b.timestamp)
    for (let i = 0; i < msgs.length - 1; i++) {
      const cur = msgs[i]
      const nxt = msgs[i + 1]
      const dt  = nxt.timestamp - cur.timestamp
      // Skip gaps > 30 min — engine was off or GPS lost
      if (dt <= 0 || dt > 1800) continue

      const dtH = dt / 3600
      const key = new Date(cur.timestamp * 1000).toISOString().slice(0, 10)
      if (!dayTotals[key]) dayTotals[key] = { distance: 0, engHours: 0, idleTime: 0 }

      // Defensive access — different device protocols report different field names
      const speed   = cur['position.speed'] ?? cur['gps.speed'] ?? cur.speed ?? 0
      const ignition = cur['engine.ignition.status'] ?? cur.ignition ?? false

      dayTotals[key].distance += speed * dtH
      if (ignition === true) {
        dayTotals[key].engHours += dtH
        if (speed === 0) dayTotals[key].idleTime += dtH
      }
    }
  })

  return Array.from({ length: 7 }, (_, i) => {
    const d   = new Date(now - (6 - i) * 86400 * 1000)
    const key = d.toISOString().slice(0, 10)
    const t   = dayTotals[key] || { distance: 0, engHours: 0, idleTime: 0 }
    return {
      day:      DAY_NAMES[d.getDay()],
      distance: Math.round(t.distance),
      engHours: Math.round(t.engHours * 10) / 10,
      idleTime: Math.round(t.idleTime * 10) / 10,
    }
  })
}

// Realistic-looking fallback data scaled to the real fleet size
function buildFallbackData(vehicleCount) {
  const count = Math.max(vehicleCount, 1)
  const now   = Date.now()
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * 86400 * 1000)
    const v = DAY_VARIATIONS[i]
    return {
      day:      DAY_NAMES[d.getDay()],
      distance: Math.round(count * 60  * v),
      engHours: Math.round(count * 5   * v * 10) / 10,
      idleTime: Math.round(count * 1.5 * v * 10) / 10,
    }
  })
}

// ── Tooltip ────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, isDark }) {
  if (!active || !payload?.length) return null
  const bg   = isDark ? '#162035' : '#ffffff'
  const ttl  = isDark ? '#ffffff' : '#1e293b'
  const body = isDark ? '#9ca3af' : '#64748b'
  const brd  = isDark ? '#253055' : '#e2e8f0'
  return (
    <div style={{ background: bg, border: `1px solid ${brd}`, borderRadius: 8, padding: '10px 12px', fontSize: 11 }}>
      <p style={{ color: ttl, fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: body, margin: '2px 0' }}>
          <span style={{ color: p.stroke }}>●</span> {p.name}: <strong style={{ color: ttl }}>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function VehicleActivity({ isDark, vehicleCount = 0 }) {
  const [chartData,  setChartData]  = useState(null)
  const [isFallback, setIsFallback] = useState(false)

  useEffect(() => {
    // Real mode without a login: the proxy can only 401 — skip it and let the
    // estimated fallback render.
    if (!hasFlespiToken()) {
      setIsFallback(true)
      return
    }

    let cancelled = false
    const timeout = setTimeout(() => {
      if (!cancelled) setIsFallback(true)
    }, 8000)

    const from = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
    const to   = Math.floor(Date.now() / 1000)

    /**
     * Flespi takes from/to/count/fields inside a JSON `data` object.
     *
     * As top-level query params — which is what this sent — they are SILENTLY
     * IGNORED: HTTP 200, and the response is every stored message on every
     * device with every field. Measured on this account that was 398,208
     * messages / 267.75 MB for what the chart uses as ~21,000 messages / 1.9 MB,
     * on every Dashboard mount, and it is what tripped Flespi's per-account REST
     * traffic limit and produced the 429s on Reports.
     *
     * Same form as replay.js and usageData.js, which already got this right.
     */
    const data = JSON.stringify({ from, to, count: MAX_MESSAGES, fields: FIELDS })
    const url = `${BASE_URL}/gw/devices/all/messages?data=${encodeURIComponent(data)}`

    fetch(url, { headers: HEADERS })
      .then(async r => {
        if (!r.ok) {
          const body = await r.text()
          console.error('[VehicleActivity] Flespi /messages error:', r.status, body)
          throw new Error(`${r.status}`)
        }
        return r.json()
      })
      .then(json => {
        if (cancelled) return
        clearTimeout(timeout)

        const msgs = json.result || []

        if (import.meta.env.DEV) {
          console.log(`[VehicleActivity] ${msgs.length} messages received`)
          if (msgs.length > 0) {
            console.log('[VehicleActivity] sample message fields:', Object.keys(msgs[0]))
            console.log('[VehicleActivity] sample message:', msgs[0])
          }
        }

        if (msgs.length === 0) throw new Error('empty result')

        setChartData(buildChartData(msgs))
        setIsFallback(false)
      })
      .catch(err => {
        if (cancelled) return
        clearTimeout(timeout)
        if (import.meta.env.DEV) {
          console.warn('[VehicleActivity] using estimated fallback —', err.message)
        }
        setIsFallback(true)
      })

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [])

  // Once vehicleCount is known and we are in fallback, generate scaled estimated data
  useEffect(() => {
    if (isFallback && vehicleCount > 0) {
      setChartData(buildFallbackData(vehicleCount))
    }
  }, [isFallback, vehicleCount])

  const grid = isDark ? 'rgba(37,48,85,0.6)' : 'rgba(226,232,240,0.8)'
  const tick  = isDark ? '#9ca3af' : '#64748b'
  const ptBd  = isDark ? '#1e2740' : '#ffffff'

  return (
    <div className="ft-card">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="ft-card-title">Vehicle Activity</h3>
          <p className="ft-card-sub">
            {isFallback && vehicleCount > 0
              ? `Estimated · ${vehicleCount} vehicles`
              : 'Last 7 days'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 mt-2">
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text2)' }}>
          <span className="inline-block h-0.5 w-4 rounded-full bg-blue-500"></span>Distance (km)
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text2)' }}>
          <span className="inline-block h-0.5 w-4 rounded-full bg-purple-500"></span>Eng. Hours
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text2)' }}>
          <span className="inline-block h-0.5 w-4 rounded-full bg-amber-500"></span>Idle Time (h)
        </span>
      </div>

      <div className="h-[110px] md:h-[140px] xl:h-[155px]">
        {!chartData ? (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--c-text3)' }}>
            Loading activity data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={grid} strokeDasharray="0" />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 'auto']} width={30} tick={{ fontSize: 9, fill: tick }} />
              <Tooltip content={<CustomTooltip isDark={isDark} />} />
              <Line type="monotone" dataKey="distance" name="Distance (km)" stroke="#5ba354" strokeWidth={2} dot={{ r: 3, fill: '#5ba354', stroke: ptBd, strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="engHours" name="Engine Hours"  stroke="#a855f7" strokeWidth={2} dot={{ r: 3, fill: '#a855f7', stroke: ptBd, strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="idleTime" name="Idle Time (h)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b', stroke: ptBd, strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
