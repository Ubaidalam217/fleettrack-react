import { Droplet } from 'lucide-react'

/**
 * Dashboard › Fuel & Energy. It used to show fixed sample numbers (895 L,
 * 4.5 L/h and a made-up week). No tracker on this account reports fuel yet
 * (read-only probe, 2026-11-09: no fuel sensor, and the one CAN bus with fuel
 * fields reads 0), so the card says so instead of showing numbers that look
 * measured. It fills in once a fuel sensor or CAN fuel data is connected and
 * its field and unit are known (utils/sensorReadings.js).
 */
export default function FuelEnergy() {
  return (
    <div className="ft-card">
      <div style={{ marginBottom: 14 }}>
        <h3 className="ft-card-title">Fuel &amp; Energy</h3>
        <p className="ft-card-sub">Consumption last 7 days</p>
      </div>
      <div className="ft-inset" style={{ padding: '22px 16px', textAlign: 'center' }}>
        <span style={{
          width: 40, height: 40, borderRadius: 12, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--ft-accent)', background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
        }} aria-hidden="true"><Droplet size={18} /></span>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)' }}>No fuel sensor data yet</div>
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--c-text3)', marginTop: 4 }}>
          Fuel use shows here once a fuel sensor or the vehicle’s CAN fuel data is connected to the tracker.
        </div>
      </div>
    </div>
  )
}
