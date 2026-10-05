/**
 * /api/me — what the logged-in account may see, from its own point of view.
 *
 * GET /api/me/vehicles is the endpoint the Live Map will call in Phase 3. It
 * exists separately from GET /api/vehicles because the map wants one flat list of
 * IMEIs to subscribe to in Flespi and does not care which BG or branch each one
 * is filed under — and because "the fleet I am allowed to watch" is a question
 * every role answers differently, which is exactly what the scope helper is for.
 */

import { Router } from 'express'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { scopedWhere } from '../lib/scope.js'

const router = Router()

/**
 * Every vehicle in scope, with its IMEI.
 *
 * No pagination. The whole point is that the client holds the complete set so it
 * can match an incoming Flespi message to a vehicle without a round trip, and a
 * partial set would silently drop devices off the map. The largest tenant in this
 * deployment is in the low hundreds of vehicles.
 */
router.get(
  '/vehicles',
  asyncHandler(async (req, res) => {
    const rows = await prisma.vehicle.findMany({
      where: scopedWhere('vehicle', req.scope),
      orderBy: [{ plateNo: 'asc' }, { imei: 'asc' }],
      select: {
        id: true,
        imei: true,
        plateNo: true,
        fleetNo: true,
        subGroup: true,
        make: true,
        model: true,
        deviceType: true,
        mobileNo: true,
        vehicleType: true,
        bgId: true,
        branchId: true,
        bg: { select: { id: true, name: true, groupId: true } },
        branch: { select: { id: true, name: true } },
      },
    })

    res.json({
      data: rows,
      // Saves the client a length check to decide whether to open the MQTT
      // subscription at all, and makes an empty result legible in a log.
      count: rows.length,
      role: req.scope.role,
    })
  })
)

export default router
