import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { dateBarHex, dateLabelEvery } from '../../utils/dateBarColors'

/**
 * The two graphs that end the client's Distance Driven report (Ctrack MaXx,
 * client 2026-11-11): the fleet's distance each day, and that day's distance
 * divided by the vehicles that made a trip.
 *
 * Laid out like the client's Ctrack image (2026-11-13): the two graphs one
 * under the other at full width, a thin bar per date in its own colour, every
 * other date labelled on two alternating rows, and a boxed legend of every
 * date under each graph. They sit on the white report paper in both themes.
 *
 * data: [{ day: '01 Oct', date?: '01 Oct, 2026', total, avg }]
 */

const INK = '#374151'
const AXIS_TITLE = { fill: '#111827', fontSize: 12, fontWeight: 700 }

/** Every other date (sparser when crowded), alternating between a lower and an upper row. */
function DateTick({ x, y, payload, every = 2 }) {
  const i = payload?.index ?? 0
  if (i % every !== 0) return null
  const upper = (i / every) % 2 === 1
  return (
    <text x={x} y={y + (upper ? 12 : 26)} textAnchor="middle" fill={INK} fontSize={10.5}>
      {payload.value}
    </text>
  )
}

function Graph({ title, data, dataKey }) {
  return (
    <div>
      {title && <div style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', textAlign: 'center', marginBottom: 6 }}>{title}</div>}
      <div style={{ height: 270, border: '1px solid #d1d5db' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 14, bottom: 20, left: 18 }} barCategoryGap="20%">
            <CartesianGrid stroke="#e5e7eb" />
            <XAxis
              dataKey="label"
              tick={<DateTick every={dateLabelEvery(data.length)} />}
              interval={0}
              height={38}
              tickLine={{ stroke: '#9ca3af' }}
              axisLine={{ stroke: '#9ca3af' }}
              label={{ value: 'Date', position: 'insideBottom', offset: -14, ...AXIS_TITLE }}
            />
            <YAxis
              tick={{ fill: INK, fontSize: 10.5 }}
              tickLine={false}
              axisLine={{ stroke: '#9ca3af' }}
              width={52}
              label={{ value: 'Distance Driven (km)', angle: -90, position: 'insideLeft', offset: -6, style: { textAnchor: 'middle', ...AXIS_TITLE } }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(10,126,156,0.06)' }}
              formatter={v => [`${v} km`, title || 'Distance Driven']}
              labelFormatter={l => l}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey={dataKey} barSize={4} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={d.label} fill={dateBarHex(i)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend data={data} />
    </div>
  )
}

/** Every date with its colour, eight to a row, in a light box. */
function Legend({ data }) {
  return (
    <div style={{
      margin: '12px 6% 0', border: '1px solid #d1d5db', padding: '8px 10px',
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(max(104px, 11.5%), 1fr))', gap: '4px 10px',
    }}>
      {data.map((d, i) => (
        <span key={d.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: INK, whiteSpace: 'nowrap' }}>
          <span style={{ width: 22, height: 13, background: dateBarHex(i), border: '1px solid rgba(0,0,0,0.12)', flex: 'none' }} />
          {d.label}
        </span>
      ))}
    </div>
  )
}

export default function DistanceDrivenCharts({ data }) {
  const rows = (data ?? []).map(d => ({ ...d, label: d.date ?? d.day }))
  return (
    <div style={{
      marginTop: 16, background: '#fff', border: '1px solid var(--c-border)', borderRadius: 10,
      padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 26, breakInside: 'avoid',
    }}>
      <Graph title="Distance Driven Graph" data={rows} dataKey="total" />
      <Graph title="Average Distance Driven per Asset" data={rows} dataKey="avg" />
    </div>
  )
}
