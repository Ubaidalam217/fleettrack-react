-- Journey Management, the rest of the Job module (client 2026-11-21, after
-- Uffizio's Job module + Route Optimization). Additive only:
--   Journey: schedule kind / template + day, start logic + buffer, route
--     tolerance, force close, convoy, load state, temperature limits;
--   JourneyStop: visit via MAP or QR (+ code), purpose, load state, address
--     and form copied at planning time;
--   JourneyLink (public TRACK / DRIVER links), JourneyStopForm, JourneyStopPhoto,
--   JourneyAddress (address book), JourneyFormTemplate (custom forms),
--   JourneyTemplate (templates without a vehicle, and recurring schedules);
--   Expense.journeyId (a cost belongs to a journey).

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "journeyId" TEXT;

-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "convoy" JSONB,
ADD COLUMN     "convoyState" JSONB,
ADD COLUMN     "convoyToleranceM" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "forceCloseMin" INTEGER,
ADD COLUMN     "forceClosedAt" TIMESTAMP(3),
ADD COLUMN     "lastTemp" DOUBLE PRECISION,
ADD COLUMN     "lastTempAt" TIMESTAMP(3),
ADD COLUMN     "loadState" TEXT,
ADD COLUMN     "occurrenceKey" TEXT,
ADD COLUMN     "routeToleranceM" INTEGER,
ADD COLUMN     "scheduleKind" TEXT NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "startBufferMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "startLogic" TEXT NOT NULL DEFAULT 'ANY_DATA',
ADD COLUMN     "tempMax" DOUBLE PRECISION,
ADD COLUMN     "tempMin" DOUBLE PRECISION,
ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "JourneyStop" ADD COLUMN     "addressId" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "formFields" JSONB,
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "formName" TEXT,
ADD COLUMN     "loadState" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "visitVia" TEXT NOT NULL DEFAULT 'MAP';

-- CreateTable
CREATE TABLE "JourneyLink" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "JourneyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyStopForm" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyStopForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyStopPhoto" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "fieldKey" TEXT,
    "caption" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByName" TEXT,

    CONSTRAINT "JourneyStopPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyAddress" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arrivalType" TEXT NOT NULL DEFAULT 'RADIUS',
    "geofenceId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusM" INTEGER NOT NULL DEFAULT 300,
    "purpose" TEXT NOT NULL DEFAULT 'OTHER',
    "code" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyFormTemplate" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyTemplate" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "body" JSONB NOT NULL,
    "scheduleKind" TEXT NOT NULL DEFAULT 'NONE',
    "repeat" TEXT,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "monthDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "horizonDays" INTEGER NOT NULL DEFAULT 7,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "generatedUntil" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "engineState" JSONB,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JourneyLink_token_key" ON "JourneyLink"("token");

-- CreateIndex
CREATE INDEX "JourneyLink_journeyId_idx" ON "JourneyLink"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyStopForm_stopId_key" ON "JourneyStopForm"("stopId");

-- CreateIndex
CREATE INDEX "JourneyStopPhoto_stopId_idx" ON "JourneyStopPhoto"("stopId");

-- CreateIndex
CREATE INDEX "JourneyAddress_bgId_idx" ON "JourneyAddress"("bgId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyAddress_bgId_name_key" ON "JourneyAddress"("bgId", "name");

-- CreateIndex
CREATE INDEX "JourneyFormTemplate_bgId_idx" ON "JourneyFormTemplate"("bgId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyFormTemplate_bgId_name_key" ON "JourneyFormTemplate"("bgId", "name");

-- CreateIndex
CREATE INDEX "JourneyTemplate_bgId_idx" ON "JourneyTemplate"("bgId");

-- CreateIndex
CREATE INDEX "JourneyTemplate_scheduleKind_active_idx" ON "JourneyTemplate"("scheduleKind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyTemplate_bgId_name_key" ON "JourneyTemplate"("bgId", "name");

-- CreateIndex
CREATE INDEX "Expense_journeyId_idx" ON "Expense"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "Journey_templateId_occurrenceKey_key" ON "Journey"("templateId", "occurrenceKey");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "JourneyTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLink" ADD CONSTRAINT "JourneyLink_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStopForm" ADD CONSTRAINT "JourneyStopForm_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "JourneyStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStopPhoto" ADD CONSTRAINT "JourneyStopPhoto_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "JourneyStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyAddress" ADD CONSTRAINT "JourneyAddress_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyFormTemplate" ADD CONSTRAINT "JourneyFormTemplate_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyTemplate" ADD CONSTRAINT "JourneyTemplate_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyTemplate" ADD CONSTRAINT "JourneyTemplate_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

