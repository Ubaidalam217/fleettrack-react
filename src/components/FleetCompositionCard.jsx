const STATUS_ROWS = [
  { key: 'running',  label: 'Running',  color: '#22c55e' },
  { key: 'idle',     label: 'Idle',     color: '#f59e0b' },
  { key: 'stopped',  label: 'Stopped',  color: '#ef4444' },
  { key: 'inactive', label: 'Inactive', color: '#9ca3af' },
  { key: 'noData',   label: 'No Data',  color: '#6b7280' },
]

export default function FleetCompositionCard({ fleetData, loading }) {
  const total    = fleetData?.total    ?? 0
  const running  = fleetData?.running  ?? 0
  const idle     = fleetData?.idle     ?? 0
  const stopped  = fleetData?.stopped  ?? 0
  const inactive = fleetData?.inactive ?? 0
  const noData   = fleetData?.noData   ?? 0

  const activeRate  = total > 0 ? Math.round(((running + idle) / total) * 100) : 0
  const uptimeRate  = total > 0 ? Math.round(((total - noData) / total) * 100) : 0

  const ratios = [
    {
      num: '1', name: 'Active Rate (Running + Idle)',
      status: activeRate >= 70 ? 'Healthy' : activeRate >= 40 ? 'Moderate' : 'Low',
      statusColor: activeRate >= 70 ? 'text-emerald-500' : activeRate >= 40 ? 'text-amber-500' : 'text-rose-500',
      value: activeRate + '%',
    },
    {
      num: '2', name: 'Fleet Uptime Rate',
      status: uptimeRate >= 80 ? 'Normal' : uptimeRate >= 60 ? 'Fair' : 'Poor',
      statusColor: uptimeRate >= 80 ? 'text-emerald-500' : uptimeRate >= 60 ? 'text-amber-500' : 'text-rose-500',
      value: uptimeRate + '%',
    },
  ]

  return (
    <div className="ft-card">
      <div className="ft-card-head" style={{ marginBottom: 10 }}>
        <div>
          <h3 className="ft-card-title">Fleet Composition</h3>
          <p className="ft-card-sub">Live status mix across the fleet</p>
        </div>
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-bold" style={{ color: 'var(--c-text1)', letterSpacing: '-0.02em' }}>
          {loading && !fleetData ? '—' : total}
        </span>
        <span className="text-xs" style={{ color: 'var(--c-text3)' }}>Total vehicles</span>
      </div>

      {!loading && total === 0 ? (
        <div className="ft-inset flex-1 flex items-center justify-center py-10">
          <span className="text-xs" style={{ color: 'var(--c-text3)' }}>No vehicles reporting</span>
        </div>
      ) : (
        <>
          {/* flex-1 + space-between: the status list absorbs the row's spare
              height instead of leaving a hole under the card's content. */}
          <div className="ft-inset overflow-hidden mb-4 flex-1 flex flex-col justify-between">
            {STATUS_ROWS.map((r, i) => {
              const count = fleetData?.[r.key] ?? 0
              return (
                <div
                  key={r.key}
                  className="flex items-center justify-between px-3 py-2.5 gap-3"
                  style={i > 0 ? { borderTop: '1px solid var(--ft-inset-border)' } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="text-xs" style={{ color: 'var(--c-text2)' }}>{r.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>{loading && !fleetData ? '—' : count}</span>
                    {total > 0 && (
                      <span className="text-[10px]" style={{ color: 'var(--c-text3)' }}>({Math.round((count / total) * 100)}%)</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-auto">
            {ratios.map((r, i) => (
              <div
                key={r.num}
                className="flex items-center gap-2 py-3"
                style={i > 0 ? { borderTop: '1px solid var(--c-border)' } : undefined}
              >
                <span className="w-4 h-4 rounded-full bg-sky-500 text-white text-[10px] flex items-center justify-center font-semibold shrink-0">
                  {r.num}
                </span>
                <span className="text-[13px] font-medium" style={{ color: 'var(--c-text2)' }}>{r.name}</span>
                <span className={`ml-auto text-[13px] ${r.statusColor}`}>{r.status}</span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--c-text1)' }}>{r.value}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${r.statusColor === 'text-emerald-500' ? 'bg-emerald-500' : r.statusColor === 'text-amber-500' ? 'bg-amber-500' : 'bg-rose-500'}`} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
