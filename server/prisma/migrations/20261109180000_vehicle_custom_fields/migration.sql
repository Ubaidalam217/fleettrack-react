-- Custom fields against a vehicle (client 2026-11-09): [{ name, value }].
ALTER TABLE "Vehicle" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "customFieldsUpdatedAt" TIMESTAMP(3),
ADD COLUMN "customFieldsUpdatedBy" TEXT;
