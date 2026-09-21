// What a vehicle marker draws, per Edit Asset vehicle type.
//
// Two tiers. Photographic top-down art is preferred and lives in
// public/vehicles (see ART_FILES); any type with no usable photo falls back to
// the hand-authored silhouettes further down this file.
//
// ── Tier 1: photographs ───────────────────────────────────────────────────
//
// The files in public/vehicles are derived assets, not the originals. The
// stock art in public/logo arrives as opaque AVIF with a VectorStock watermark
// bar burnt into the bottom edge, and the sedan rests pointing east.
// scripts/prep-vehicles.mjs crops the watermark, keys the backdrop out by
// flooding from the border, rotates each vehicle to point north and trims it
// into a 256px square PNG. That script is not wired into the build: its output
// is checked in, so it only ever runs again if new art arrives.
//
// These are real photographs, so nothing here recolours them. Status is
// carried entirely by the ring drawn around the image (see VehicleMarker) —
// tinting a red truck green to mean "Driving" would destroy the one thing the
// photo was brought in for.

// Art that actually exists on disk. Adding a file means adding a line here.
const ART_FILES = {
  sedan: '/vehicles/sedan.png',
  truck: '/vehicles/truck.png',
}

// Per type, the art to use in order of preference. The first name that ART_FILES
// actually has wins; a type that gets something other than its first choice, or
// nothing at all, warns once (see resolveArt).
//
// bus reuses the truck: both are long, boxy, flat-roofed and read the same at
// 40px. bike and machine have no honest stand-in among a sedan and a lorry, so
// they keep their silhouettes rather than render as the wrong vehicle.
const ART_PREFERENCE = {
  car:     ['sedan', 'hatchback'],
  truck:   ['truck'],
  bus:     ['bus', 'truck'],
  bike:    ['bike'],
  machine: ['machine'],
}

const warned = new Set()

function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[vehicleIcons] ${message}`)
}

// type -> url or null. Memoised because this runs per marker per status change
// and the answer can never change within a session.
const artCache = new Map()

function resolveArt(key) {
  if (artCache.has(key)) return artCache.get(key)

  const prefs = ART_PREFERENCE[key]
  const hit   = prefs?.find(name => ART_FILES[name]) ?? null

  if (!prefs) {
    // Unknown type. Falls through to the car silhouette; not worth a warning,
    // since an empty vehicleType is the normal state of an unconfigured fleet.
  } else if (!hit) {
    warnOnce(key, `no image found for vehicle type "${key}" (looked for ${prefs.join(', ')} in public/vehicles) — falling back to the drawn silhouette. Drop a transparent PNG in and add it to ART_FILES to use a photo.`)
  } else if (hit !== prefs[0]) {
    warnOnce(key, `no "${prefs[0]}" image for vehicle type "${key}" — falling back to the closest match, "${hit}".`)
  }

  const url = hit ? ART_FILES[hit] : null
  artCache.set(key, url)
  return url
}

/**
 * URL of the photographic marker art for a vehicle type, or null when that
 * type has none and the caller should draw {@link vehicleSvg} instead.
 *
 * @param {string} type Edit Asset `master.vehicleType`.
 */
export function vehicleArt(type) {
  return resolveArt(String(type || '').toLowerCase())
}

// ── Tier 2: drawn silhouettes ─────────────────────────────────────────────
//
// Hand-authored inline SVG rather than an icon package: these are rendered
// through L.divIcon as raw HTML strings, so anything that ships as a React
// component would have to be serialised first.
//
// House rules for every icon in here, because the map is the only place they
// are ever seen:
//   * 32x32 viewBox, drawn pointing north. The marker rotates the whole box by
//     the vehicle's heading, so anything that is not symmetric about the
//     vertical axis will look wrong once it turns. The SVG scales to whatever
//     the marker's rotation box is, so the 32 is a grid, not a pixel size.
//   * The body is filled with the status colour and outlined in white. The
//     white keel is what keeps a dark-green "Driving" marker legible on top of
//     a park or a motorway on the OSM raster tiles.
//   * Glass is white at ~90% and the cabin floor is navy at ~25%. Those two
//     tones are the whole shading vocabulary — flat and sharp at 32px beats
//     gradients, which turn to mud.
//   * Tyres/tracks are painted first so the body covers their inner half.

const OUTLINE = '#ffffff'
const TYRE    = '#1c2b3c'
const GLASS   = 'rgba(255,255,255,0.92)'
const FLOOR   = 'rgba(15,36,55,0.28)'
const TRIM    = 'rgba(255,255,255,0.55)'

// Saloon: tapered nose, glasshouse down the middle, wing mirrors at the A
// pillar. The mirrors are the cheapest possible "this is a car and not a van"
// signal at this size.
//
// Deliberately the narrowest of the three four-wheelers — at 32px the width
// difference against the bus is doing more work than any interior detail.
function car(color) {
  return `
  <g fill="${TYRE}">
    <rect x="5.7" y="6.8" width="2.9" height="5.0" rx="1.2"/>
    <rect x="23.4" y="6.8" width="2.9" height="5.0" rx="1.2"/>
    <rect x="5.7" y="19.8" width="2.9" height="5.4" rx="1.2"/>
    <rect x="23.4" y="19.8" width="2.9" height="5.4" rx="1.2"/>
  </g>
  <g stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round">
    <path d="M8.4 10.7 L5.8 10.1 L5.55 11.7 L8.4 12.1 Z" fill="${color}"/>
    <path d="M23.6 10.7 L26.2 10.1 L26.45 11.7 L23.6 12.1 Z" fill="${color}"/>
    <path d="M16 3.2 C13.2 3.2 11.6 4.3 11.0 6.5 L9.9 11.0 C8.9 11.6 8.4 12.7 8.4 14.1
             L8.4 24.6 C8.4 27.4 10.6 29.0 16 29.0 C21.4 29.0 23.6 27.4 23.6 24.6
             L23.6 14.1 C23.6 12.7 23.1 11.6 22.1 11.0 L21.0 6.5 C20.4 4.3 18.8 3.2 16 3.2 Z" fill="${color}"/>
  </g>
  <path d="M11.0 11.9 C12.6 11.4 14.2 11.2 16 11.2 C17.8 11.2 19.4 11.4 21.0 11.9
           L20.1 14.9 L11.9 14.9 Z" fill="${GLASS}"/>
  <rect x="11.6" y="15.4" width="8.8" height="6.6" rx="1.3" fill="${FLOOR}"/>
  <path d="M11.9 22.5 L20.1 22.5 L21.0 25.5 C19.4 26.0 17.8 26.2 16 26.2
           C14.2 26.2 12.6 26.0 11.0 25.5 Z" fill="${TRIM}"/>`
}

// Rigid truck: short cab up front, long cargo box behind, and a visible gap
// between the two with the chassis showing through. That break in the
// silhouette is what tells a truck from a bus when both are 32px and rotating.
function truck(color) {
  return `
  <g fill="${TYRE}">
    <rect x="3.9" y="5.2" width="2.9" height="4.4" rx="1.2"/>
    <rect x="25.2" y="5.2" width="2.9" height="4.4" rx="1.2"/>
    <rect x="3.5" y="16.2" width="3.2" height="5.2" rx="1.3"/>
    <rect x="25.3" y="16.2" width="3.2" height="5.2" rx="1.3"/>
    <rect x="3.5" y="22.2" width="3.2" height="5.2" rx="1.3"/>
    <rect x="25.3" y="22.2" width="3.2" height="5.2" rx="1.3"/>
  </g>
  <rect x="13.4" y="9.4" width="5.2" height="3.4" fill="${TYRE}"/>
  <g stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round">
    <path d="M9.2 2.4 L22.8 2.4 C24.0 2.4 24.8 3.2 24.8 4.4 L24.8 10.4 L7.2 10.4
             L7.2 4.4 C7.2 3.2 8.0 2.4 9.2 2.4 Z" fill="${color}"/>
    <rect x="6.3" y="11.8" width="19.4" height="17.6" rx="1.8" fill="${color}"/>
  </g>
  <rect x="9.6" y="3.9" width="12.8" height="3.4" rx="0.9" fill="${GLASS}"/>
  <rect x="8.3" y="13.5" width="15.4" height="14.3" rx="1.1" fill="${FLOOR}"/>
  <g fill="${TRIM}">
    <rect x="9.6" y="15.6" width="12.8" height="1.05" rx="0.5"/>
    <rect x="9.6" y="19.6" width="12.8" height="1.05" rx="0.5"/>
    <rect x="9.6" y="23.6" width="12.8" height="1.05" rx="0.5"/>
  </g>`
}

// Coach: one uninterrupted box, square shoulders, a window band down each
// flank. Wider and blunter than the car, unbroken unlike the truck.
function bus(color) {
  return `
  <g fill="${TYRE}">
    <rect x="4.6" y="6.8" width="2.9" height="4.8" rx="1.2"/>
    <rect x="24.5" y="6.8" width="2.9" height="4.8" rx="1.2"/>
    <rect x="4.6" y="21.0" width="2.9" height="4.8" rx="1.2"/>
    <rect x="24.5" y="21.0" width="2.9" height="4.8" rx="1.2"/>
  </g>
  <rect x="7.0" y="2.2" width="18.0" height="27.6" rx="3.4"
        fill="${color}" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M9.5 5.0 C11.6 4.2 20.4 4.2 22.5 5.0 L22.5 8.4 L9.5 8.4 Z" fill="${GLASS}"/>
  <rect x="10.0" y="9.9" width="12.0" height="16.4" rx="1.2" fill="${FLOOR}"/>
  <g fill="${TRIM}">
    <rect x="7.9" y="10.8" width="1.5" height="3.2" rx="0.6"/>
    <rect x="7.9" y="15.0" width="1.5" height="3.2" rx="0.6"/>
    <rect x="7.9" y="19.2" width="1.5" height="3.2" rx="0.6"/>
    <rect x="22.6" y="10.8" width="1.5" height="3.2" rx="0.6"/>
    <rect x="22.6" y="15.0" width="1.5" height="3.2" rx="0.6"/>
    <rect x="22.6" y="19.2" width="1.5" height="3.2" rx="0.6"/>
    <rect x="10.4" y="27.0" width="11.2" height="1.5" rx="0.7"/>
  </g>`
}

// Motorcycle: a deliberately thin silhouette — the narrow footprint is the
// identifying feature, so nothing here is allowed to widen past the bars.
function bike(color) {
  return `
  <g fill="${TYRE}">
    <rect x="14.5" y="2.8" width="3.0" height="7.4" rx="1.5"/>
    <rect x="14.2" y="21.4" width="3.6" height="8.0" rx="1.8"/>
  </g>
  <g stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round">
    <rect x="7.6" y="7.4" width="16.8" height="2.6" rx="1.3" fill="${color}"/>
    <path d="M16 8.6 C13.0 8.6 11.9 10.6 11.9 13.0 L11.9 17.6 C11.9 20.8 13.2 23.2 16 23.2
             C18.8 23.2 20.1 20.8 20.1 17.6 L20.1 13.0 C20.1 10.6 19.0 8.6 16 8.6 Z" fill="${color}"/>
  </g>
  <rect x="13.1" y="17.0" width="5.8" height="5.6" rx="2.0" fill="${FLOOR}"/>
  <circle cx="16" cy="12.4" r="1.9" fill="${GLASS}"/>`
}

// Tracked plant — excavator read from above: two crawler tracks, a slewing
// house between them, boom and bucket reaching out over the nose.
function machine(color) {
  return `
  <g fill="${TYRE}">
    <rect x="3.6" y="7.0" width="5.4" height="19.4" rx="1.8"/>
    <rect x="23.0" y="7.0" width="5.4" height="19.4" rx="1.8"/>
  </g>
  <g fill="${TRIM}">
    <rect x="4.3" y="9.6" width="4.0" height="0.95" rx="0.45"/>
    <rect x="4.3" y="13.2" width="4.0" height="0.95" rx="0.45"/>
    <rect x="4.3" y="16.8" width="4.0" height="0.95" rx="0.45"/>
    <rect x="4.3" y="20.4" width="4.0" height="0.95" rx="0.45"/>
    <rect x="23.7" y="9.6" width="4.0" height="0.95" rx="0.45"/>
    <rect x="23.7" y="13.2" width="4.0" height="0.95" rx="0.45"/>
    <rect x="23.7" y="16.8" width="4.0" height="0.95" rx="0.45"/>
    <rect x="23.7" y="20.4" width="4.0" height="0.95" rx="0.45"/>
  </g>
  <g stroke="${OUTLINE}" stroke-width="1.25" stroke-linejoin="round">
    <rect x="13.6" y="3.6" width="4.8" height="9.4" rx="1.0" fill="${color}"/>
    <rect x="11.4" y="1.4" width="9.2" height="3.4" rx="0.9" fill="${color}"/>
    <rect x="8.4" y="10.6" width="15.2" height="14.4" rx="2.2" fill="${color}"/>
  </g>
  <rect x="10.4" y="12.4" width="11.2" height="4.6" rx="1.1" fill="${GLASS}"/>
  <rect x="10.4" y="18.4" width="11.2" height="5.0" rx="1.1" fill="${FLOOR}"/>`
}

const SHAPES = { car, truck, bus, bike, machine }

/**
 * Markup for one vehicle marker.
 *
 * @param {string} type  Edit Asset `master.vehicleType`. Empty, unknown and
 *                       undefined all fall back to the car, which is the only
 *                       sane default for a fleet whose metadata is still being
 *                       filled in — ten of ten devices had no type set when
 *                       this shipped.
 * @param {string} color Status colour (see utils/vehicleStatus).
 */
export function vehicleSvg(type, color) {
  const shape = SHAPES[String(type || '').toLowerCase()] || car
  // Sized by the marker's rotation box rather than fixed pixels, so the drawn
  // silhouettes land at exactly the same size as the photographs beside them.
  return `<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">${shape(color)}</svg>`
}
