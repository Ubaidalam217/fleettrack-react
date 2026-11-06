-- Driver Management, phase 1 (client, 2026-11-06): profile, licence and
-- document details, photo, uploaded documents, and a Suspended status.

ALTER TYPE "Status" ADD VALUE IF NOT EXISTS 'Suspended';

ALTER TABLE "Driver"
  ADD COLUMN "driverNo" SERIAL NOT NULL,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN "employeeId" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "joiningDate" TIMESTAMP(3),
  ADD COLUMN "photoKey" TEXT,
  ADD COLUMN "licenseCategory" TEXT,
  ADD COLUMN "licenseIssueDate" TIMESTAMP(3),
  ADD COLUMN "licenseCountry" TEXT,
  ADD COLUMN "visaExpiry" TIMESTAMP(3),
  ADD COLUMN "emiratesId" TEXT,
  ADD COLUMN "emiratesIdExpiry" TIMESTAMP(3),
  ADD COLUMN "medicalExpiry" TIMESTAMP(3);

CREATE UNIQUE INDEX "Driver_driverNo_key" ON "Driver"("driverNo");
CREATE UNIQUE INDEX "Driver_photoKey_key" ON "Driver"("photoKey");

CREATE TABLE "DriverPhoto" (
    "driverId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverPhoto_pkey" PRIMARY KEY ("driverId")
);
CREATE UNIQUE INDEX "DriverPhoto_key_key" ON "DriverPhoto"("key");
ALTER TABLE "DriverPhoto" ADD CONSTRAINT "DriverPhoto_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DriverDocument" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DriverDocument_driverId_idx" ON "DriverDocument"("driverId");
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
