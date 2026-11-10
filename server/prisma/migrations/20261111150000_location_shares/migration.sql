-- Live location share links (client, 2026-11-10): one vehicle's current position until the link expires.

-- CreateTable
CREATE TABLE "LocationShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "vehicleName" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LocationShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationShare_token_key" ON "LocationShare"("token");

-- CreateIndex
CREATE INDEX "LocationShare_createdById_idx" ON "LocationShare"("createdById");

-- CreateIndex
CREATE INDEX "LocationShare_deviceId_idx" ON "LocationShare"("deviceId");
