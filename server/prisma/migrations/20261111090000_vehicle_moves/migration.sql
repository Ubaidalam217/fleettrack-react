-- Reallocation History (client report list 2026-11-10): vehicle branch / group / GGB changes.

-- CreateTable
CREATE TABLE "VehicleMove" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehicleLabel" TEXT NOT NULL,
    "imei" TEXT,
    "level" TEXT NOT NULL,
    "fromName" TEXT,
    "toName" TEXT,
    "movedById" TEXT,
    "movedByName" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleMove_bgId_movedAt_idx" ON "VehicleMove"("bgId", "movedAt");

-- CreateIndex
CREATE INDEX "VehicleMove_vehicleId_idx" ON "VehicleMove"("vehicleId");

-- AddForeignKey
ALTER TABLE "VehicleMove" ADD CONSTRAINT "VehicleMove_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMove" ADD CONSTRAINT "VehicleMove_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
