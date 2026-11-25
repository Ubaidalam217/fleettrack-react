-- Client, 2026-11-25: show ALL the Uffizio vehicles' data in FleetmaxX (Live
-- Map, vehicle panel, replay). lib/uffizio.js keeps each vehicle's latest
-- live row and a ~2-minute position trail (90 days). Additive only.

-- CreateTable
CREATE TABLE "UffizioState" (
    "vehicleId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "gpsTs" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ign" BOOLEAN,
    "status" TEXT,
    "odometerKm" DOUBLE PRECISION,
    "driverName" TEXT,
    "driverTag" TEXT,
    "externalVolt" DOUBLE PRECISION,
    "batteryPct" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "sos" BOOLEAN,
    "power" BOOLEAN,
    "satellites" INTEGER,
    "location" TEXT,
    "vehicleType" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UffizioState_pkey" PRIMARY KEY ("vehicleId")
);

-- CreateTable
CREATE TABLE "UffizioPosition" (
    "vehicleId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ign" BOOLEAN,
    "odometerKm" DOUBLE PRECISION,
    "driverTag" TEXT,
    "externalVolt" DOUBLE PRECISION,

    CONSTRAINT "UffizioPosition_pkey" PRIMARY KEY ("vehicleId","ts")
);

-- CreateIndex
CREATE INDEX "UffizioPosition_ts_idx" ON "UffizioPosition"("ts");

-- AddForeignKey
ALTER TABLE "UffizioState" ADD CONSTRAINT "UffizioState_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UffizioPosition" ADD CONSTRAINT "UffizioPosition_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
