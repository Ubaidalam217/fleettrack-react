-- Speed limit and grace time per geo zone (client 2026-11-09).
ALTER TABLE "Geofence" ADD COLUMN "speedLimitKmh" INTEGER,
ADD COLUMN "speedGraceSec" INTEGER NOT NULL DEFAULT 0;
