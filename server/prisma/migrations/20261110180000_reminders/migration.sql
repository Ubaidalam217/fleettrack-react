-- Maintenance and renewal reminders (client 2026-11-10): rules, their vehicles,
-- Mark done history, and the engine hours the server counts from ignition.

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "byDuration" BOOLEAN NOT NULL DEFAULT true,
    "byDistance" BOOLEAN NOT NULL DEFAULT false,
    "byEngineHours" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'Monthly',
    "every" INTEGER,
    "notifyDays" INTEGER,
    "everyKm" DOUBLE PRECISION,
    "notifyKm" DOUBLE PRECISION,
    "everyHours" DOUBLE PRECISION,
    "notifyHours" DOUBLE PRECISION,
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderVehicle" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "kmBefore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursBefore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startOdometer" DOUBLE PRECISION,
    "startEngineHours" DOUBLE PRECISION,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "alerted" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderAck" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehicleLabel" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "odometer" DOUBLE PRECISION,
    "engineHours" DOUBLE PRECISION,
    "note" TEXT,
    "expenseId" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleEngineHours" (
    "vehicleId" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastTs" INTEGER,
    "lastIgnition" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleEngineHours_pkey" PRIMARY KEY ("vehicleId")
);

-- CreateIndex
CREATE INDEX "ReminderRule_bgId_idx" ON "ReminderRule"("bgId");

-- CreateIndex
CREATE INDEX "ReminderVehicle_vehicleId_idx" ON "ReminderVehicle"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderVehicle_ruleId_vehicleId_key" ON "ReminderVehicle"("ruleId", "vehicleId");

-- CreateIndex
CREATE INDEX "ReminderAck_bgId_idx" ON "ReminderAck"("bgId");

-- CreateIndex
CREATE INDEX "ReminderAck_vehicleId_idx" ON "ReminderAck"("vehicleId");

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderVehicle" ADD CONSTRAINT "ReminderVehicle_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ReminderRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderVehicle" ADD CONSTRAINT "ReminderVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderAck" ADD CONSTRAINT "ReminderAck_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderAck" ADD CONSTRAINT "ReminderAck_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ReminderRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderAck" ADD CONSTRAINT "ReminderAck_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleEngineHours" ADD CONSTRAINT "VehicleEngineHours_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
