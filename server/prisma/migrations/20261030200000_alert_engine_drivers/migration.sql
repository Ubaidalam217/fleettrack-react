-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "params" JSONB,
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'Medium';

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "bgId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "deviceId" INTEGER,
    "driverId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertState" (
    "alertId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("alertId","subject")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "licenseNo" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "vehicleId" TEXT,
    "notes" TEXT,
    "status" "Status" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertEvent_bgId_occurredAt_idx" ON "AlertEvent"("bgId", "occurredAt");

-- CreateIndex
CREATE INDEX "AlertEvent_alertId_occurredAt_idx" ON "AlertEvent"("alertId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_vehicleId_key" ON "Driver"("vehicleId");

-- CreateIndex
CREATE INDEX "Driver_bgId_idx" ON "Driver"("bgId");

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertState" ADD CONSTRAINT "AlertState_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

