-- Client, 2026-11-24: each fuel vehicle's calibration (Fuel Liter / Voltage
-- table, tank capacity, reading method). Replaced ones stay as history.

-- CreateTable
CREATE TABLE "FuelCalibration" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "tankCapacityL" DOUBLE PRECISION,
    "points" JSONB NOT NULL DEFAULT '[]',
    "fileName" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),
    "replacedByName" TEXT,

    CONSTRAINT "FuelCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelCalibration_vehicleId_createdAt_idx" ON "FuelCalibration"("vehicleId", "createdAt");

-- One calibration in use per vehicle (not expressible in the Prisma schema).
CREATE UNIQUE INDEX "FuelCalibration_one_active_per_vehicle" ON "FuelCalibration"("vehicleId") WHERE "active";

-- AddForeignKey
ALTER TABLE "FuelCalibration" ADD CONSTRAINT "FuelCalibration_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
