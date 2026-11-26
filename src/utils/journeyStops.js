/**
 * Adding stops to a journey being planned (client 2026-11-26: "point 1, point 2
 * ... when I add point 3 it must be the last, not slip into the middle").
 *
 * A new point is added at the END, and the last point is the destination: the
 * destination that was there becomes an ordinary stop (its default name
 * "Destination" turns into "Stop n"), and the delivery details that belong to
 * the final point (signature, purpose, load state, form) move to the new last
 * one. A destination the user named themselves keeps its name.
 */

const isDefaultDestination = s => /^destination$/i.test(String(s?.name ?? '').trim())

/** The details that describe the final point of a journey, not a stop on the way. */
const FINAL_DETAILS = ['signatureRequired', 'purpose', 'loadState', 'formId']

/**
 * @param {object[]} list  the stops now (at least a start and a destination)
 * @param {object[]} added the new stops, in order (each at least {lat, lng})
 * @param {(over?: object) => object} make  creates a stop with its defaults
 * @returns {object[]} a new list: list + added, the last being the destination
 */
export function appendStops(list, added, make = o => ({ ...o })) {
  const out = [...list]
  if (!added.length) return out
  const li = out.length - 1
  const oldLast = li >= 1 ? out[li] : null
  if (oldLast) {
    out[li] = {
      ...oldLast,
      name: isDefaultDestination(oldLast) ? `Stop ${li}` : oldLast.name,
      stayMin: oldLast.stayMin || 15,
      ...Object.fromEntries(FINAL_DETAILS.map(k => [k, k === 'signatureRequired' ? false : null])),
    }
  }
  added.forEach((a, i) => {
    const isLast = i === added.length - 1
    const base = { ...a }
    if (isLast && oldLast) for (const k of FINAL_DETAILS) if (base[k] == null || base[k] === false) base[k] = oldLast[k] ?? base[k]
    out.push(make({
      ...base,
      name: base.name || (isLast ? 'Destination' : `Stop ${out.length}`),
      // A stop on the way stays a while; the destination as the old one did.
      stayMin: base.stayMin ?? (isLast ? (oldLast?.stayMin ?? 0) : 15),
    }))
  })
  // Tidy: in the middle, only the last one is "Destination".
  return out.map((s, k) => (k < out.length - 1 && isDefaultDestination(s) ? { ...s, name: `Stop ${k}` } : s))
}
