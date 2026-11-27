-- Client, 2026-11-27: the fuel calibration of 8 of the 11 Uffizio vehicles never applied.
-- Their tracker model (FMC130) names the sensor port "BLE Fuel Level 1" and the other
-- (FMM130) "BLE Fuel Level #1"; the calibrations were saved against "#1" and a
-- reading of another port was never converted. Ports are now kept without the "#"
-- (src/utils/fuelCalibration.js canonicalPort). Data only.

-- A reading stored under both names at the same time would collide: keep the plain one.
DELETE FROM "FuelReading" a
USING "FuelReading" b
WHERE a."port" LIKE '%#%'
  AND b."vehicleId" = a."vehicleId"
  AND b."ts" = a."ts"
  AND b."port" = btrim(regexp_replace(replace(a."port", '#', ''), '\s+', ' ', 'g'));

UPDATE "FuelReading"
SET "port" = btrim(regexp_replace(replace("port", '#', ''), '\s+', ' ', 'g'))
WHERE "port" LIKE '%#%';

UPDATE "FuelCalibration"
SET "port" = btrim(regexp_replace(replace("port", '#', ''), '\s+', ' ', 'g'))
WHERE "port" LIKE '%#%';
