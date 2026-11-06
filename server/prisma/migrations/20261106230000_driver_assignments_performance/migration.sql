-- Driver Management phases 2-4 (client, 2026-11-06): assignment history,
-- incident records, and account settings (the fatigue rule).

CREATE TABLE "DriverAssignment" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DriverAssignment_driverId_idx" ON "DriverAssignment"("driverId");
CREATE INDEX "DriverAssignment_vehicleId_idx" ON "DriverAssignment"("vehicleId");
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every current driver-vehicle pairing becomes an open Primary assignment,
-- dated from when the driver was added (the best "since" there is).
INSERT INTO "DriverAssignment" ("id", "driverId", "vehicleId", "role", "startDate")
SELECT 'asg_' || "id", "id", "vehicleId", 'Primary', "createdAt" FROM "Driver" WHERE "vehicleId" IS NOT NULL;

CREATE TABLE "DriverIncident" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "cost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverIncident_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DriverIncident_driverId_idx" ON "DriverIncident"("driverId");
ALTER TABLE "DriverIncident" ADD CONSTRAINT "DriverIncident_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverIncident" ADD CONSTRAINT "DriverIncident_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
