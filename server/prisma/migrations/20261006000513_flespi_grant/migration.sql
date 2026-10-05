-- CreateTable
CREATE TABLE "FlespiGrant" (
    "userId" TEXT NOT NULL,
    "flespiTokenId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "deviceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlespiGrant_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "FlespiGrant_flespiTokenId_idx" ON "FlespiGrant"("flespiTokenId");

-- AddForeignKey
ALTER TABLE "FlespiGrant" ADD CONSTRAINT "FlespiGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

