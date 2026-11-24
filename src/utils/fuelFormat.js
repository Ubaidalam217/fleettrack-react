/** Fuel figures as the pages show them (pure). */

const nf = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

/** 123.456 → "123.5 L"; null → "—". */
export const fmtLitres = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${nf(v, d)} L`)

/** A raw sensor value, as sent: 3796 → "3,796". */
export const fmtRaw = v => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : nf(v, Number.isInteger(Number(v)) ? 0 : 1))

/** Why a reading has no litres, in plain words. */
export function flagText(flag) {
  switch (flag) {
    case 'out_of_range': return 'Outside the calibration — not converted'
    case 'no_calibration': return 'Not calibrated — raw value'
    case 'no_tank': return 'Tank capacity missing'
    case 'other_port': return 'Not the calibrated port'
    case 'clamped': return 'At the end of the table'
    default: return ''
  }
}
