-- Odometer correction: the vehicle's real odometer = the tracker's reading +
-- this offset (set from "Update the ODO meter reading"). Null = never set.
ALTER TABLE "Vehicle" ADD COLUMN "odometerOffsetKm" DOUBLE PRECISION;
ALTER TABLE "Vehicle" ADD COLUMN "odometerSetAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "odometerSetBy" TEXT;
