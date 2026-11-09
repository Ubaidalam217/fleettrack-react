-- The rest of the reference system's driver form (client 2026-11-09): second
-- contact, address, Tag Via, employment dates, licence available, life
-- insurance and mediclaim; a leave register; a document issue date.

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactNumber2" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "drivingSince" TIMESTAMP(3),
ADD COLUMN     "leavingDate" TIMESTAMP(3),
ADD COLUMN     "licenseAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lifeInsuranceExpiry" TIMESTAMP(3),
ADD COLUMN     "lifeInsuranceNo" TEXT,
ADD COLUMN     "mediclaimExpiry" TIMESTAMP(3),
ADD COLUMN     "mediclaimNo" TEXT,
ADD COLUMN     "retirementDate" TIMESTAMP(3),
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street1" TEXT,
ADD COLUMN     "street2" TEXT,
ADD COLUMN     "tagType" TEXT,
ADD COLUMN     "zipCode" TEXT;

-- AlterTable
ALTER TABLE "DriverDocument" ADD COLUMN     "issueDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DriverLeave" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "days" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverLeave_driverId_idx" ON "DriverLeave"("driverId");

-- AddForeignKey
ALTER TABLE "DriverLeave" ADD CONSTRAINT "DriverLeave_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
