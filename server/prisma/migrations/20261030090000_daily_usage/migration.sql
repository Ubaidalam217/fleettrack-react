-- CreateTable
CREATE TABLE "DailyUsage" (
    "deviceId" INTEGER NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "ignitionSec" INTEGER NOT NULL,
    "capped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("deviceId","day")
);

-- CreateTable
CREATE TABLE "UsageDay" (
    "day" VARCHAR(10) NOT NULL,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageDay_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "DailyUsage_day_idx" ON "DailyUsage"("day");

