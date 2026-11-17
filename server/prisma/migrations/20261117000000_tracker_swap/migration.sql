-- FleetmaxX is the master of trackers (client, 2026-11-17: "it should be updated
-- with the new information but keep the history of change and we can search
-- it ... we will add front end and that will link with flespi"). Trackers are
-- changed, removed and merged in the app; nothing is deleted.

-- A vehicle may have no tracker: the tracker was taken out and the vehicle stays
-- with its history. The unique index stays; Postgres allows many NULLs under it.
ALTER TABLE "Vehicle" ALTER COLUMN "imei" DROP NOT NULL;

-- The Flespi device the vehicle was last linked to (a record; the IMEI stays the join key).
ALTER TABLE "Vehicle" ADD COLUMN "flespiDeviceId" INTEGER;

-- Archived vehicles: merged into another and kept, never deleted.
ALTER TABLE "Vehicle" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "mergedIntoId" TEXT;

-- What the user typed with a change, searchable in the history.
ALTER TABLE "VehicleMove" ADD COLUMN "note" TEXT;

-- The history is searched by who made the change.
CREATE INDEX "VehicleMove_movedByName_idx" ON "VehicleMove"("movedByName");
