-- Latest state per device.
CREATE TABLE "DeviceState" (
    "deviceId" INTEGER NOT NULL,
    "ident" TEXT,
    "ts" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ignition" BOOLEAN,
    "odometerKm" DOUBLE PRECISION,
    "satellites" INTEGER,
    "valid" BOOLEAN,
    "fuel" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "extra" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceState_pkey" PRIMARY KEY ("deviceId")
);

CREATE INDEX "DeviceState_ts_idx" ON "DeviceState"("ts");

-- Message history, partitioned by day on "ts" (unix seconds). The daily
-- partitions are created and dropped by lib/telemetry.js; the DEFAULT
-- partition catches anything outside them (a late backfill) so no write fails.
CREATE TABLE "TelemetryMessage" (
    "deviceId" INTEGER NOT NULL,
    "ts" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ignition" BOOLEAN,
    "odometerKm" DOUBLE PRECISION,
    "satellites" INTEGER,
    "valid" BOOLEAN,
    "fuel" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "extra" JSONB,

    CONSTRAINT "TelemetryMessage_pkey" PRIMARY KEY ("deviceId", "ts")
) PARTITION BY RANGE ("ts");

CREATE TABLE "TelemetryMessage_default" PARTITION OF "TelemetryMessage" DEFAULT;
