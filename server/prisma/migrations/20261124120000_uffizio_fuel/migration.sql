-- Client, 2026-11-24: 11 Al Jaber Leasing vehicles report only to their
-- Uffizio/Trakzee system. lib/uffizio.js pulls them in through Uffizio's API
-- and stores their fuel readings here. Additive only.

-- Where a vehicle's data comes from: 'FLESPI' (every vehicle so far) or 'UFFIZIO'.
ALTER TABLE "Vehicle" ADD COLUMN "dataSource" TEXT NOT NULL DEFAULT 'FLESPI';

-- CreateTable
CREATE TABLE "FuelReading" (
    "id" BIGSERIAL NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "port" TEXT NOT NULL,
    "raw" DOUBLE PRECISION NOT NULL,
    "litres" DOUBLE PRECISION,
    "ign" BOOLEAN,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FuelReading_vehicleId_port_ts_key" ON "FuelReading"("vehicleId", "port", "ts");
CREATE INDEX "FuelReading_vehicleId_ts_idx" ON "FuelReading"("vehicleId", "ts");
CREATE INDEX "FuelReading_ts_idx" ON "FuelReading"("ts");

-- AddForeignKey
ALTER TABLE "FuelReading" ADD CONSTRAINT "FuelReading_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
