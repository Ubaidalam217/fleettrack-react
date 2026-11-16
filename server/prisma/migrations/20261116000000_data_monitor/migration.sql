-- Device Data Monitor (client, 2026-11-16: "If any device sends a lot of data it
-- should report to the app and take some action", and see which device or source
-- makes a lot of requests). Hourly counts per tracker and per Flespi caller,
-- kept 30 days by lib/trafficMonitor.js. No backfill: the counts start when the
-- server with this release starts.

-- A system event (data overload, Flespi request overload) belongs to no BG: only
-- a Super Admin's scope matches a row with a null bgId.
ALTER TABLE "AlertEvent" ALTER COLUMN "bgId" DROP NOT NULL;

-- Open episodes of one type are looked up at start (WHERE type = ? AND endedAt IS NULL).
CREATE INDEX "AlertEvent_type_endedAt_idx" ON "AlertEvent"("type", "endedAt");

-- CreateTable
CREATE TABLE "DeviceTrafficStat" (
    "deviceId" INTEGER NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "msgs" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "exactDuplicates" INTEGER NOT NULL DEFAULT 0,
    "fast" INTEGER NOT NULL DEFAULT 0,
    "intervalSum" BIGINT NOT NULL DEFAULT 0,
    "intervalCount" INTEGER NOT NULL DEFAULT 0,
    "late" INTEGER NOT NULL DEFAULT 0,
    "parked" INTEGER NOT NULL DEFAULT 0,
    "reconnects" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeviceTrafficStat_pkey" PRIMARY KEY ("deviceId", "hour")
);

-- CreateIndex
CREATE INDEX "DeviceTrafficStat_hour_idx" ON "DeviceTrafficStat"("hour");

-- CreateTable
CREATE TABLE "FlespiRequestStat" (
    "hour" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "throttled" INTEGER NOT NULL DEFAULT 0,
    "shed" INTEGER NOT NULL DEFAULT 0,
    "local" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FlespiRequestStat_pkey" PRIMARY KEY ("hour", "kind", "key")
);

-- CreateIndex
CREATE INDEX "FlespiRequestStat_hour_idx" ON "FlespiRequestStat"("hour");
