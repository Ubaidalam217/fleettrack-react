-- Client, 2026-11-25: "import these vehicles as they are and edit later".
-- Uffizio fills an Uffizio vehicle's plate / fleet no. only when it is first
-- imported; after that FleetmaxX owns them and a poll only keeps what Uffizio
-- calls the vehicle today, shown as information. Additive only.
ALTER TABLE "Vehicle" ADD COLUMN "uffizioName" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "uffizioNo" TEXT;
