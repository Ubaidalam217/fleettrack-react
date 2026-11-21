-- Client, 2026-11-21: an event (battery tamper, power disconnect ...) must be
-- switchable off per vehicle, so it stops reaching the front end. A fuel tanker
-- is refilled and a driver rests with the battery taken off, and that is not a
-- tamper. The alert engine skips a vehicle's muted types.
ALTER TABLE "Vehicle" ADD COLUMN "mutedAlerts" TEXT[] DEFAULT ARRAY[]::TEXT[];
