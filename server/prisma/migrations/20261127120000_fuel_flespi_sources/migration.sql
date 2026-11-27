-- Client, 2026-11-27: fuel from Flespi trackers (Smart5). The CAN percent method now
-- reads the port 'can.fuel.level' (it was the placeholder 'can' before any source
-- existed); the new CAN_VOLUME method reads 'can.fuel.volume'. Data only, nothing dropped.
UPDATE "FuelCalibration" SET "port" = 'can.fuel.level' WHERE "method" = 'CAN' AND "port" = 'can';
UPDATE "FuelReading" SET "port" = 'can.fuel.level' WHERE "port" = 'can';
