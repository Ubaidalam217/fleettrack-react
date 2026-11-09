-- Public replay links with an expiry (client 2026-11-09).
CREATE TABLE "ReplayShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "vehicleName" TEXT NOT NULL,
    "fromTs" INTEGER NOT NULL,
    "toTs" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "points" JSONB NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ReplayShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReplayShare_token_key" ON "ReplayShare"("token");
CREATE INDEX "ReplayShare_createdById_idx" ON "ReplayShare"("createdById");
