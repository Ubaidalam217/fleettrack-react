-- Driver iButton / driver-ID tag (client, 2026-11-06): the tag code the tracker
-- reports in ibutton.code, so the app can show the driver who actually drove.
ALTER TABLE "Driver" ADD COLUMN "ibuttonCode" TEXT;

CREATE UNIQUE INDEX "Driver_ibuttonCode_key" ON "Driver"("ibuttonCode");
