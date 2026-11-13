-- A violation's end, length and worst reading (client, 2026-11-13: the
-- violation reports show From, To, Duration and Max Speed). Filled by the alert
-- engine when the episode ends; null for instant events and older rows.
ALTER TABLE "AlertEvent" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "AlertEvent" ADD COLUMN "durationSec" INTEGER;
ALTER TABLE "AlertEvent" ADD COLUMN "peakValue" DOUBLE PRECISION;
