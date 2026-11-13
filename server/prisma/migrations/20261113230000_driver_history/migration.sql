-- Driver history is kept (client, 2026-11-13: "All the drivers names will stay
-- as it is, it will not replace with last one saved"). A past trip keeps the
-- driver who drove it when the vehicle gets another driver, when the tag moves
-- to someone else, and when the driver is removed.

-- Removing a driver archives it: the row stays, so its name stays on its trips
-- and its DriverAssignment / DriverTagHistory rows are never cascaded away. The
-- foreign keys stay ON DELETE CASCADE for the one hard delete left — a whole
-- Business Group, Group or GGB — which RESTRICT would make fail.
ALTER TABLE "Driver" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN "deletedBy" TEXT;

-- Who held which iButton / driver-ID tag when.
CREATE TABLE "DriverTagHistory" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverTagHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DriverTagHistory_code_idx" ON "DriverTagHistory"("code");
CREATE INDEX "DriverTagHistory_driverId_idx" ON "DriverTagHistory"("driverId");
ALTER TABLE "DriverTagHistory" ADD CONSTRAINT "DriverTagHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1: every tag held today becomes an open row with no start ("since
-- always"). No earlier holder of any tag was ever recorded, so today's holder
-- is the only one the data knows of — the same driver these reads showed until
-- now, and the rule a newly registered tag follows from here on.
INSERT INTO "DriverTagHistory" ("id", "driverId", "code", "startDate")
SELECT 'tag_' || "id", "id", "ibuttonCode", NULL FROM "Driver" WHERE "ibuttonCode" IS NOT NULL;

-- Backfill 2: a driver who holds a vehicle but has no open Primary row on it
-- gets one. It starts when the driver was added — no assignment can be older
-- than its driver, as the phase 2 migration already dated them — or, when a
-- recorded Primary period on that vehicle ended later, at that end, so it
-- never overlaps a known one.
INSERT INTO "DriverAssignment" ("id", "driverId", "vehicleId", "role", "startDate")
SELECT 'asg_h_' || d."id", d."id", d."vehicleId", 'Primary',
       GREATEST(d."createdAt", COALESCE(
         (SELECT max(a."endDate") FROM "DriverAssignment" a WHERE a."vehicleId" = d."vehicleId" AND a."role" = 'Primary'),
         d."createdAt"))
FROM "Driver" d
WHERE d."vehicleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "DriverAssignment" a
    WHERE a."driverId" = d."id" AND a."vehicleId" = d."vehicleId" AND a."role" = 'Primary' AND a."endDate" IS NULL
  );
