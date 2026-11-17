-- Journey Management, phase 1 (client 2026-11-13/16/17; design journey-design.md §A):
-- journeys with their stops (chained schedule, six arrival/departure events,
-- delivery signature), the journey event log, saved routes, per-BG settings
-- and the notice log of the two-stage alert escalation. Additive only.
--
-- One vehicle, one journey at a time is enforced in lib/journeys.js under
-- pg_advisory_xact_lock(hashtext(vehicleId)), not by a constraint here.

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('Draft', 'Scheduled', 'Started', 'InProgress', 'Delayed', 'Completed', 'Cancelled', 'Interrupted');

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "journeyNo" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "customer" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "type" TEXT NOT NULL DEFAULT 'ONE_WAY',
    "status" "JourneyStatus" NOT NULL DEFAULT 'Draft',
    "instructions" TEXT,
    "vehicleId" TEXT,
    "vehicleLabel" TEXT NOT NULL,
    "driverId" TEXT,
    "driverName" TEXT,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "expectedArrival" TIMESTAMP(3) NOT NULL,
    "plannedDistanceKm" DOUBLE PRECISION,
    "plannedDriveMin" INTEGER,
    "plannedStayMin" INTEGER,
    "routeSource" TEXT NOT NULL DEFAULT 'STRAIGHT',
    "routeTemplateId" TEXT,
    "plannedPath" JSONB,
    "recordedFrom" JSONB,
    "approvalStatus" TEXT NOT NULL DEFAULT 'NONE',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "actualStart" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progressKm" DOUBLE PRECISION,
    "remainingKm" DOUBLE PRECISION,
    "etaAt" TIMESTAMP(3),
    "delayMin" INTEGER,
    "offRouteCount" INTEGER NOT NULL DEFAULT 0,
    "offRouteSec" INTEGER NOT NULL DEFAULT 0,
    "maxOffRouteM" INTEGER,
    "unplannedStops" INTEGER NOT NULL DEFAULT 0,
    "unplannedStopSec" INTEGER NOT NULL DEFAULT 0,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastSpeed" DOUBLE PRECISION,
    "lastFixAt" TIMESTAMP(3),
    "engineState" JSONB,
    "createdById" TEXT,
    "createdByName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyStop" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arrivalType" TEXT NOT NULL DEFAULT 'RADIUS',
    "geofenceId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusM" INTEGER NOT NULL DEFAULT 300,
    "polygon" JSONB,
    "stayMin" INTEGER NOT NULL DEFAULT 0,
    "legKm" DOUBLE PRECISION,
    "legDriveMin" INTEGER,
    "legSource" TEXT,
    "alongKm" DOUBLE PRECISION,
    "plannedArrive" TIMESTAMP(3),
    "plannedDepart" TIMESTAMP(3),
    "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "actualArrive" TIMESTAMP(3),
    "actualDepart" TIMESTAMP(3),
    "dwellSec" INTEGER,
    "arriveTiming" TEXT,
    "arriveDiffMin" INTEGER,
    "departTiming" TEXT,
    "departDiffMin" INTEGER,
    "detectedBy" TEXT,
    "checkInSource" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInByName" TEXT,

    CONSTRAINT "JourneyStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneySignature" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "signedByName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByName" TEXT,

    CONSTRAINT "JourneySignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT,
    "fromStatus" "JourneyStatus",
    "toStatus" "JourneyStatus",
    "stopSeq" INTEGER,
    "message" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "auto" BOOLEAN NOT NULL DEFAULT true,
    "actorId" TEXT,
    "actorName" TEXT,
    "alertEventId" TEXT,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteTemplate" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "path" JSONB,
    "distanceKm" DOUBLE PRECISION,
    "driveMin" INTEGER,
    "stops" JSONB NOT NULL DEFAULT '[]',
    "recordedFrom" JSONB,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneySetting" (
    "bgId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "JourneySetting_pkey" PRIMARY KEY ("bgId")
);

-- CreateTable
CREATE TABLE "JourneyNotice" (
    "id" TEXT NOT NULL,
    "journeyEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "JourneyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Journey_journeyNo_key" ON "Journey"("journeyNo");

-- CreateIndex
CREATE INDEX "Journey_bgId_plannedStart_idx" ON "Journey"("bgId", "plannedStart");

-- CreateIndex
CREATE INDEX "Journey_bgId_approvalStatus_idx" ON "Journey"("bgId", "approvalStatus");

-- CreateIndex
CREATE INDEX "Journey_status_plannedStart_idx" ON "Journey"("status", "plannedStart");

-- CreateIndex
CREATE INDEX "Journey_vehicleId_plannedStart_idx" ON "Journey"("vehicleId", "plannedStart");

-- CreateIndex
CREATE INDEX "Journey_driverId_plannedStart_idx" ON "Journey"("driverId", "plannedStart");

-- CreateIndex
CREATE INDEX "JourneyStop_geofenceId_idx" ON "JourneyStop"("geofenceId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyStop_journeyId_seq_key" ON "JourneyStop"("journeyId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "JourneySignature_stopId_key" ON "JourneySignature"("stopId");

-- CreateIndex
CREATE INDEX "JourneyEvent_journeyId_occurredAt_idx" ON "JourneyEvent"("journeyId", "occurredAt");

-- CreateIndex
CREATE INDEX "JourneyEvent_bgId_occurredAt_idx" ON "JourneyEvent"("bgId", "occurredAt");

-- CreateIndex
CREATE INDEX "JourneyEvent_alertEventId_idx" ON "JourneyEvent"("alertEventId");

-- CreateIndex
CREATE INDEX "RouteTemplate_bgId_idx" ON "RouteTemplate"("bgId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteTemplate_bgId_name_key" ON "RouteTemplate"("bgId", "name");

-- CreateIndex
CREATE INDEX "JourneyNotice_journeyEventId_idx" ON "JourneyNotice"("journeyEventId");

-- CreateIndex
CREATE INDEX "JourneyNotice_userId_sentAt_idx" ON "JourneyNotice"("userId", "sentAt");

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStop" ADD CONSTRAINT "JourneyStop_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySignature" ADD CONSTRAINT "JourneySignature_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "JourneyStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteTemplate" ADD CONSTRAINT "RouteTemplate_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySetting" ADD CONSTRAINT "JourneySetting_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

