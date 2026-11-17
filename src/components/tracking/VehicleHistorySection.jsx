import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History } from 'lucide-react'
import { listVehicleHistory } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { moveSentence, moveTone } from '../../utils/vehicleHistory'

/**
 * The vehicle's latest changes in "Vehicle information" (client, 2026-11-17:
 * "keep the history of change and we can search it"): trackers installed or
 * taken out, renames, moves, shares and merges, newest first, with who and the
 * note. "Full history" opens the Reallocation History report on this vehicle.
 * Uses the dialog's vi-* styles.
 */

const SHOWN = 8

const CSS = `
.vh-hist{margin-top:4px;border:1px solid var(--c-border);border-radius:12px;overflow:auto}
.vh-hist table{width:100%;border-collapse:collapse;font-size:12px}
.vh-hist th{text-align:left;padding:8px 10px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text3);background:var(--c-input);white-space:nowrap}
.vh-hist td{padding:8px 10px;border-top:1px solid var(--c-border);vertical-align:top}
.vh-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.vh-sub{font-size:11.5px;color:var(--c-text3)}
@media (max-width:640px){.vh-hist .vh-hide{display:none}}
`

const fmtWhen = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function VehicleHistorySection({ vehicleId, label }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!IS_REAL || !vehicleId) return
    let alive = true
    listVehicleHistory(vehicleId, SHOWN)
      .then(d => { if (alive) setRows(Array.isArray(d) ? d : []) })
      .catch(err => { if (alive) setError(err?.message || 'Could not load the history') })
    return () => { alive = false }
  }, [vehicleId])

  if (!IS_REAL) return null
  return (
    <>
      <style>{CSS}</style>
      <div className="vi-sechead">
        <div className="vi-sectitle"><History size={15} />History {rows && <span className="vi-count">{rows.length}{rows.length === SHOWN ? '+' : ''}</span>}</div>
        <button type="button" className="vi-btn" style={{ padding: '4px 10px', fontSize: 12 }}
          onClick={() => navigate('/reports/reallocation-history', { state: { search: label } })}>
          Full history
        </button>
      </div>
      {error ? <div className="vi-errtxt">{error}</div>
        : !rows ? <div className="vh-sub">Loading…</div>
          : !rows.length ? <div className="vh-sub">No changes recorded yet. Tracker changes, renames and moves are kept from now on.</div>
            : (
              <div className="vh-hist">
                <table>
                  <thead><tr><th>When</th><th>Change</th><th className="vh-hide">By</th><th className="vh-hide">Note</th></tr></thead>
                  <tbody>
                    {rows.map(m => (
                      <tr key={m.id}>
                        <td className="vh-num">{fmtWhen(m.movedAt)}</td>
                        <td style={{ fontWeight: 600, color: moveTone(m) ?? undefined }}>{moveSentence(m)}</td>
                        <td className="vh-hide">{m.movedByName || '—'}</td>
                        <td className="vh-hide" style={{ color: 'var(--c-text3)' }}>{m.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </>
  )
}
