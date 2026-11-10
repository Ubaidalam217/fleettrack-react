-- Reallocation History: Business Group moves (readable by the BG they left) and tracker installs.

-- AlterTable
ALTER TABLE "VehicleMove" ADD COLUMN     "fromBgId" TEXT;

-- CreateIndex
CREATE INDEX "VehicleMove_fromBgId_idx" ON "VehicleMove"("fromBgId");

-- CreateIndex
CREATE INDEX "VehicleMove_imei_idx" ON "VehicleMove"("imei");
