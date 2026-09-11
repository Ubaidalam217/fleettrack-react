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
    <div className="bg-[#f4f5f7] rounded-2xl p-5 h-full flex flex-col">
      <h3 className="text-slate-900 font-semibold text-[15px] mb-2">Fleet Composition</h3>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-slate-900 text-3xl font-bold">
          {loading && !fleetData ? '—' : total}
        </span>
        <span className="text-slate-400 text-xs">Total vehicles</span>
      </div>

      {!loading && total === 0 ? (
        <div className="bg-white rounded-xl flex-1 flex items-center justify-center py-10">
          <span className="text-slate-400 text-xs">No vehicles reporting</span>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl divide-y divide-slate-100 overflow-hidden mb-4">
            {STATUS_ROWS.map(r => {
              const count = fleetData?.[r.key] ?? 0
              return (
                <div key={r.key} className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="text-slate-600 text-xs">{r.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-slate-900 text-sm font-semibold">{loading && !fleetData ? '—' : count}</span>
                    {total > 0 && (
                      <span className="text-slate-400 text-[10px]">({Math.round((count / total) * 100)}%)</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-auto divide-y divide-slate-200">
            {ratios.map(r => (
              <div key={r.num} className="flex items-center gap-2 py-3">
                <span className="w-4 h-4 rounded-full bg-sky-500 text-white text-[10px] flex items-center justify-center font-semibold shrink-0">
                  {r.num}
                </span>
                <span className="text-slate-700 text-sm font-medium">{r.name}</span>
                <span className={`ml-auto text-sm ${r.statusColor}`}>{r.status}</span>
                <span className="text-slate-900 text-sm font-semibold">{r.value}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${r.statusColor === 'text-emerald-500' ? 'bg-emerald-500' : r.statusColor === 'text-amber-500' ? 'bg-amber-500' : 'bg-rose-500'}`} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
