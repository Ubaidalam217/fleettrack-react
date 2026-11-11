import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

/**
 * The two graphs that end the client's Distance Driven report (Ctrack MaXx,
 * client 2026-11-11): the fleet's distance each day, and that day's distance
 * divided by the vehicles that made a trip.
 *
 * data: [{ day: '01 Oct', total, avg }]
 */

const TICK = { fill: '#374151', fontSize: 10.5 }

function Graph({ title, data, dataKey, unit }) {
  return (
    <div style={{ flex: '1 1 420px', minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#374151', textAlign: 'center', marginBottom: 6 }}>{title}</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="day" tick={TICK} tickLine={false} axisLine={{ stroke: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ fill: 'rgba(10,126,156,0.08)' }}
              formatter={v => [`${v} ${unit}`, title]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey={dataKey} fill="#0a8fb0" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function DistanceDrivenCharts({ data }) {
  return (
    <div style={{
      marginTop: 16, background: '#fff', border: '1px solid var(--c-border)', borderRadius: 10,
      padding: '14px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', breakInside: 'avoid',
    }}>
      <Graph title="Distance Driven Graph (km)" data={data} dataKey="total" unit="km" />
      <Graph title="Average Distance Driven per Asset (km)" data={data} dataKey="avg" unit="km" />
    </div>
  )
}
