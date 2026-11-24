/**
 * /api/public/journey/:token — a journey's public links, no sign-in (client
 * 2026-11-21, after Uffizio's "Send tracking link" and its driver app):
 *
 *   TRACK   read only: where the vehicle is, the stops done and ahead, the
 *           ETA. For the customer / the job's contact person.
 *   DRIVER  the same, plus the driver's actions at each stop: check in (a QR
 *           stop needs its code — scanned, or typed when the camera fails),
 *           fill the stop's form, take a photo, sign for the delivery.
 *
 *   GET  /:token
 *   POST /:token/stops/:seq/check-in   { code?, lat?, lng? }          DRIVER
 *   POST /:token/stops/:seq/form       { answers }                    DRIVER
 *   POST /:token/stops/:seq/photos     { data, fieldKey?, caption? }  DRIVER
 *   POST /:token/stops/:seq/signature  { data, signedByName? }        DRIVER
 *
 * The token (32 random characters) is the only key; it expires and can be
 * switched off from the journey. An unknown, switched-off or expired link
 * answers the same 404 / 410 without naming the journey. Everything shown
 * comes from the journey as the engine last wrote it — opening a link never
 * calls Flespi. A stop's code is never sent: the QR is the proof.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http.js'
import { validate } from '../middleware/validate.js'
import { fromBase64, sniffImage } from '../lib/files.js'
import { ACTIVE, FINAL, LIST_INCLUDE, STOP_SELECT, checkInStop, linkStop, recordEvent } from '../lib/journeys.js'
import { vehicleLabel } from '../lib/vehicleLabel.js'
import { journeyRef, displayStatus } from '../../../src/utils/journeySchedule.js'
import { savePhoto, saveForm, MAX_SIGNATURE_BYTES } from './journeys.js'

export const publicRouter = Router()

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/

async function linkOf(req) {
  const token = String(req.params.token ?? '')
  const link = TOKEN.test(token) ? await prisma.journeyLink.findUnique({ where: { token } }) : null
  if (!link || link.revokedAt) throw new HttpError(404, 'This link does not exist or was switched off')
  if (link.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'This link has expired')
  const journey = await prisma.journey.findUnique({ where: { id: link.journeyId }, include: LIST_INCLUDE })
  if (!journey) throw new HttpError(404, 'This link does not exist or was switched off')
  return { link, journey }
}

function driverOnly(link) {
  if (link.kind !== 'DRIVER') throw forbidden('This is a tracking link: it can only be viewed')
}

function stopOf(j, seqParam) {
  const seq = Number(seqParam)
  const stop = j.stops.find(s => s.seq === seq)
  if (!Number.isInteger(seq) || !stop) throw notFound('Stop')
  return stop
}

const iso = d => (d ? new Date(d).toISOString() : null)

publicRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const { link, journey: j } = await linkOf(req)
    // Remember it was opened (at most once a minute).
    if (!link.lastOpenedAt || Date.now() - link.lastOpenedAt.getTime() > 60_000) {
      await prisma.journeyLink.update({ where: { id: link.id }, data: { lastOpenedAt: new Date() } }).catch(() => null)
    }
    const driver = link.kind === 'DRIVER'
    const onRoad = ACTIVE.includes(j.status) || j.status === 'Completed'
    res.json({
      data: {
        kind: link.kind,
        expiresAt: link.expiresAt.toISOString(),
        refreshSec: 30,
        journey: {
          ref: journeyRef(j), title: j.title, status: j.status, display: displayStatus(j),
          vehicleLabel: j.vehicle ? vehicleLabel(j.vehicle) || j.vehicleLabel : j.vehicleLabel,
          // The driver's first name only on a customer's link.
          driverName: driver ? j.driverName : j.driverName ? String(j.driverName).split(/\s+/)[0] : null,
          customer: j.customer,
          plannedStart: iso(j.plannedStart), expectedArrival: iso(j.expectedArrival), etaAt: iso(j.etaAt),
          actualStart: iso(j.actualStart), actualArrival: iso(j.actualArrival), delayMin: j.delayMin,
          plannedDistanceKm: j.plannedDistanceKm, progressKm: j.progressKm, remainingKm: j.remainingKm,
          position: onRoad && j.lastLat != null ? { lat: j.lastLat, lng: j.lastLng, speed: j.lastSpeed, at: iso(j.lastFixAt) } : null,
          plannedPath: Array.isArray(j.plannedPath) ? j.plannedPath : null,
          instructions: driver ? j.instructions : null,
          stops: j.stops.map(s => linkStop(s, { driver })),
          canAct: driver && !FINAL.includes(j.status) && j.status !== 'Draft',
        },
      },
    })
  })
)

publicRouter.post(
  '/:token/stops/:seq/check-in',
  validate(z.object({
    code: z.union([z.string().trim().max(40), z.null()]).optional(),
    lat: z.union([z.null(), z.coerce.number().min(-90).max(90)]).optional(),
    lng: z.union([z.null(), z.coerce.number().min(-180).max(180)]).optional(),
  })),
  asyncHandler(async (req, res) => {
    const { link, journey: j } = await linkOf(req)
    driverOnly(link)
    const stop = stopOf(j, req.params.seq)
    // The QR's text is the code itself, or a link that ends with it.
    const given = String(req.body.code ?? '').trim().toUpperCase().split(/[/:#?=]/).pop()
    if (stop.visitVia === 'QR') {
      if (!given) throw badRequest('Validation failed', { code: 'Scan the QR at the stop, or type its code' })
      if (given !== String(stop.code ?? '').toUpperCase()) throw badRequest('Validation failed', { code: 'That code is not this stop\'s' })
    } else if (given && given !== String(stop.code ?? '').toUpperCase()) {
      throw badRequest('Validation failed', { code: 'That code is not this stop\'s' })
    }
    const row = await checkInStop(j, stop, {
      source: 'DRIVER', byName: j.driverName ?? 'Driver', via: given ? 'QR' : 'DRIVER',
      lat: req.body.lat ?? null, lng: req.body.lng ?? null,
    })
    res.json({ data: linkStop(row, { driver: true }) })
  })
)

publicRouter.post(
  '/:token/stops/:seq/form',
  validate(z.object({ answers: z.record(z.string(), z.any()) })),
  asyncHandler(async (req, res) => {
    const { link, journey: j } = await linkOf(req)
    driverOnly(link)
    if (FINAL.includes(j.status) && j.status !== 'Completed') throw conflict('This journey was cancelled')
    const stop = stopOf(j, req.params.seq)
    await saveForm(j, stop, req.body.answers, { source: 'DRIVER_APP', byName: j.driverName ?? 'Driver' })
    const fresh = await prisma.journeyStop.findUnique({ where: { id: stop.id }, select: STOP_SELECT })
    res.status(201).json({ data: linkStop(fresh, { driver: true }) })
  })
)

publicRouter.post(
  '/:token/stops/:seq/photos',
  validate(z.object({ data: z.string().min(16).max(4_300_000), fieldKey: z.union([z.string().trim().max(40), z.null()]).optional(), caption: z.union([z.string().trim().max(200), z.null()]).optional() })),
  asyncHandler(async (req, res) => {
    const { link, journey: j } = await linkOf(req)
    driverOnly(link)
    if (j.status === 'Cancelled') throw conflict('This journey was cancelled')
    const stop = stopOf(j, req.params.seq)
    res.status(201).json({ data: await savePhoto(j, stop, req.body, { source: 'DRIVER_APP', byName: j.driverName ?? 'Driver' }) })
  })
)

publicRouter.post(
  '/:token/stops/:seq/signature',
  validate(z.object({ data: z.string().min(16).max(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 64), signedByName: z.union([z.string().trim().max(120), z.null()]).optional() })),
  asyncHandler(async (req, res) => {
    const { link, journey: j } = await linkOf(req)
    driverOnly(link)
    if (j.status === 'Cancelled') throw conflict('This journey was cancelled')
    const stop = stopOf(j, req.params.seq)
    if (stop.signature) throw conflict('This stop is already signed')
    const data = fromBase64(req.body.data)
    const mimeType = sniffImage(data)
    if (!mimeType) throw badRequest('Upload the signature as a PNG, JPEG or WebP image', { data: 'Unsupported file type' })
    if (data.length > MAX_SIGNATURE_BYTES) throw new HttpError(413, 'The signature image is too large (max 512 KB)')
    const signedByName = req.body.signedByName || null
    // The same store as the office's "Sign here", marked as from the driver (phase 1's DRIVER_APP).
    await prisma.journeySignature.create({ data: { stopId: stop.id, signedByName, source: 'DRIVER_APP', mimeType, size: data.length, data, uploadedByName: j.driverName ?? 'Driver' } })
    await recordEvent(j, { type: 'SIGNATURE', stopSeq: stop.seq, message: `${stop.name}: signed${signedByName ? ` by ${signedByName}` : ''} (driver link)` }, { alert: false })
    const fresh = await prisma.journeyStop.findUnique({ where: { id: stop.id }, select: STOP_SELECT })
    res.status(201).json({ data: linkStop(fresh, { driver: true }) })
  })
)

export default publicRouter
