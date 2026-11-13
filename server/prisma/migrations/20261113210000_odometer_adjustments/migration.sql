-- Odometer adjustment history: one row per "Update odometer" — the reading
-- typed, the tracker's reading then, and the correction that followed.
CREATE TABLE "OdometerAdjustment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "readingKm" DOUBLE PRECISION NOT NULL,
    "deviceKm" DOUBLE PRECISION NOT NULL,
    "offsetKm" DOUBLE PRECISION NOT NULL,
    "previousOffsetKm" DOUBLE PRECISION,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setBy" TEXT,
    "note" TEXT,

    CONSTRAINT "OdometerAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OdometerAdjustment_vehicleId_setAt_idx" ON "OdometerAdjustment"("vehicleId", "setAt");

-- AddForeignKey
ALTER TABLE "OdometerAdjustment" ADD CONSTRAINT "OdometerAdjustment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
