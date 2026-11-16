-- Vehicle multi-assign (client, 2026-11-13: "One vehicle can be assigned to
-- multiple Group, BG, Branch"). A vehicle keeps its one owner (Vehicle.bgId /
-- branchId); each VehicleShare row is another place it also shows. No backfill:
-- every existing vehicle starts with no shares, so nothing changes until one is made.

-- CreateTable
CREATE TABLE "VehicleShare" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "groupId" TEXT,
    "bgId" TEXT,
    "branchId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleShare_pkey" PRIMARY KEY ("id"),
    -- The right target columns for each level, and targetId is that target.
    CONSTRAINT "VehicleShare_level_check" CHECK (
        ("level" = 'group'  AND "groupId" IS NOT NULL AND "bgId" IS NULL     AND "branchId" IS NULL     AND "targetId" = "groupId")
     OR ("level" = 'bg'     AND "groupId" IS NULL     AND "bgId" IS NOT NULL AND "branchId" IS NULL     AND "targetId" = "bgId")
     OR ("level" = 'branch' AND "groupId" IS NULL     AND "bgId" IS NOT NULL AND "branchId" IS NOT NULL AND "targetId" = "branchId")
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleShare_vehicleId_targetId_key" ON "VehicleShare"("vehicleId", "targetId");

-- CreateIndex
CREATE INDEX "VehicleShare_groupId_idx" ON "VehicleShare"("groupId");

-- CreateIndex
CREATE INDEX "VehicleShare_bgId_idx" ON "VehicleShare"("bgId");

-- CreateIndex
CREATE INDEX "VehicleShare_branchId_idx" ON "VehicleShare"("branchId");

-- AddForeignKey
ALTER TABLE "VehicleShare" ADD CONSTRAINT "VehicleShare_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleShare" ADD CONSTRAINT "VehicleShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleShare" ADD CONSTRAINT "VehicleShare_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleShare" ADD CONSTRAINT "VehicleShare_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
