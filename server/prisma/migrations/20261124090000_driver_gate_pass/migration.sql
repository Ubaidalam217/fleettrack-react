-- Gate pass (site access card) of a driver for the Expiry Gate Pass report
-- (client 2026-11-24): tag number, expiry date, contractor. All optional.

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "contractorName" TEXT,
ADD COLUMN     "gatePassExpiry" TIMESTAMP(3),
ADD COLUMN     "gatePassTag" TEXT;
