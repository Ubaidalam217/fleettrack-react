import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, FileText } from 'lucide-react'
import { useSettingsProfile } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { listExpenses } from '../../data/expenses'
import { aed, expenseRows } from '../../utils/expenseReport'
import { dateStr } from '../../utils/reportRange'
import { formatExpiryDate } from '../../utils/licenceExpiry'

/**
 * Vehicle Info › Expenses (client, 2026-11-12: "add in vehicle info"): what
 * this vehicle cost this month and over the last six, its latest expenses,
 * and the full Expense Report for it. Renders inside VehicleInfo's card grid
 * and uses its vinfo-* styles. A Fix expense counts by the days of its period
 * inside each range, as in the report (utils/expenseReport.js).
 */
export default function VehicleExpenses({ imei }) {
  const navigate = useNavigate()
  const profile = useSettingsProfile(imei)
  const vehicleId = profile.linked ? profile.vehicle?.id : null
  const [list, setList] = useState(null)
  const [error, setError] = useState(false)

  const now = useMemo(() => new Date(), [])
  const today = dateStr(now)
  const monthStart = dateStr(new Date(now.getFullYear(), now.getMonth(), 1))
  const sixStart = dateStr(new Date(now.getFullYear(), now.getMonth() - 5, 1))

  useEffect(() => {
    if (!IS_REAL || !vehicleId) return
    let live = true
    setList(null)
    setError(false)
    listExpenses({ vehicleId, from: sixStart })
      .then(d => { if (live) setList(d ?? []) })
      .catch(() => { if (live) { setList([]); setError(true) } })
    return () => { live = false }
  }, [vehicleId, sixStart])

  const figures = useMemo(() => {
    if (!list) return null
    const sum = rows => rows.reduce((s, r) => s + r.amount, 0)
    const recent = expenseRows(list, sixStart, today).slice().reverse().slice(0, 5)
    return { month: sum(expenseRows(list, monthStart, today)), six: sum(expenseRows(list, sixStart, today)), recent }
  }, [list, monthStart, sixStart, today])

  const openReport = () => navigate(`/reports/expense?vehicle=${encodeURIComponent(vehicleId)}`)

  return (
    <section className="vinfo-card wide">
      <div className="vinfo-head">
        <span className="vinfo-ico"><Receipt size={15} /></span>
        <span className="vinfo-title">Expenses</span>
        {vehicleId && IS_REAL && (
          <button type="button" className="vinfo-btn" onClick={openReport}><FileText size={12} />Full report</button>
        )}
      </div>
      {!IS_REAL ? (
        <div className="vinfo-note">Expenses are kept on the server, so they are not shown in demo mode.</div>
      ) : !vehicleId ? (
        <div className="vinfo-note">Register the tracker under Settings › Object › Vehicle to keep its expenses.</div>
      ) : list === null ? (
        <div className="vinfo-note">Loading…</div>
      ) : error ? (
        <div className="vinfo-note">The expenses could not be loaded.</div>
      ) : (
        <>
          <div className="vinfo-fields four">
            <div className="vinfo-f">
              <div className="vinfo-l">This Month</div>
              <div className="vinfo-v"><span>{aed(figures.month)}</span></div>
            </div>
            <div className="vinfo-f">
              <div className="vinfo-l">Last 6 Months</div>
              <div className="vinfo-v"><span>{aed(figures.six)}</span></div>
            </div>
          </div>
          {figures.recent.length ? (
            <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
              <div className="vinfo-l">Latest expenses</div>
              {figures.recent.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5, color: 'var(--c-text1)', minWidth: 0 }}>
                  <span style={{ width: 92, flexShrink: 0, color: 'var(--c-text3)' }}>{formatExpiryDate(r.date)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 650 }}>
                    {r.type}{r.vendor ? <span style={{ color: 'var(--c-text3)', fontWeight: 500 }}> · {r.vendor}</span> : null}
                  </span>
                  <span style={{ flexShrink: 0, fontWeight: 700 }}>{aed(r.category === 'Fix' ? r.fullAmount : r.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="vinfo-empty" style={{ marginTop: 12 }}>No expenses in the last six months. Add them under Settings › Master › Expense.</div>
          )}
        </>
      )}
    </section>
  )
}
