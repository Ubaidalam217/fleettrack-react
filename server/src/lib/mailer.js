/**
 * Alert emails over SMTP (any provider — Brevo, Mailgun, Google Workspace).
 *
 * Off until SMTP_HOST is set: an unconfigured server simply records alerts in
 * the app and sends nothing, rather than failing the alert pass. The SMTP
 * password lives only in server/.env on the VPS.
 */

import nodemailer from 'nodemailer'
import env from '../env.js'

let transport = null
let warned = false

export const isMailConfigured = () => !!(env.SMTP_HOST && env.MAIL_FROM)

function getTransport() {
  if (transport) return transport
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return transport
}

const SEVERITY_COLOR = { Low: '#64748b', Medium: '#d97706', High: '#dc2626', Critical: '#7f1d1d' }

const escape = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Uae local "30 Oct 2026, 21:46". */
function uaeTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

/**
 * Send one alert to its recipients. Returns true when the SMTP server accepted
 * it; false when mail is not configured or the send failed (logged, not thrown).
 */
export async function sendAlertEmail(recipients, event) {
  if (!isMailConfigured()) {
    if (!warned) console.warn('[fleetmax] alert emails are off: set SMTP_HOST and MAIL_FROM in server/.env')
    warned = true
    return false
  }
  const color = SEVERITY_COLOR[event.severity] ?? SEVERITY_COLOR.Medium
  const when = uaeTime(event.occurredAt)
  const map = event.lat != null && event.lng != null
    ? `<p style="margin:12px 0 0"><a href="https://www.google.com/maps?q=${event.lat},${event.lng}" style="color:#2563eb">Open location on the map</a></p>`
    : ''
  try {
    await getTransport().sendMail({
      from: env.MAIL_FROM,
      to: recipients.join(', '),
      subject: `[${event.severity}] ${event.title} — ${event.message.split(':')[0]}`,
      text: `${event.title}\n${event.message}\n${when} (UAE)\nSeverity: ${event.severity}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px">
  <div style="border-left:4px solid ${color};padding:12px 16px;background:#f8fafc">
    <div style="font-size:12px;color:${color};font-weight:700;text-transform:uppercase">${escape(event.severity)} alert</div>
    <div style="font-size:16px;font-weight:700;margin:4px 0 8px">${escape(event.title)}</div>
    <div style="font-size:14px;color:#0f172a">${escape(event.message)}</div>
    <div style="font-size:12px;color:#64748b;margin-top:8px">${escape(when)} (UAE time)</div>
    ${map}
  </div>
  <p style="font-size:11px;color:#94a3b8">Sent by FleetmaX. Change who receives this in Settings &gt; Alerts.</p>
</div>`,
    })
    return true
  } catch (err) {
    console.error(`[fleetmax] alert email to ${recipients.length} recipient(s) failed: ${err.message}`)
    return false
  }
}
