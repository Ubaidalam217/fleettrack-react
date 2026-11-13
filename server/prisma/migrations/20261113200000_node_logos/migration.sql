-- A logo for each GGB, Group, Business Group and Branch (client, 2026-11-13):
-- shown at the left of every report header for the accounts below it.
ALTER TABLE "Ggb" ADD COLUMN "logoKey" TEXT;
ALTER TABLE "Group" ADD COLUMN "logoKey" TEXT;
ALTER TABLE "BusinessGroup" ADD COLUMN "logoKey" TEXT;
ALTER TABLE "Branch" ADD COLUMN "logoKey" TEXT;

CREATE UNIQUE INDEX "Ggb_logoKey_key" ON "Ggb"("logoKey");
CREATE UNIQUE INDEX "Group_logoKey_key" ON "Group"("logoKey");
CREATE UNIQUE INDEX "BusinessGroup_logoKey_key" ON "BusinessGroup"("logoKey");
CREATE UNIQUE INDEX "Branch_logoKey_key" ON "Branch"("logoKey");

-- CreateTable
CREATE TABLE "NodeLogo" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ggbId" TEXT,
    "groupId" TEXT,
    "bgId" TEXT,
    "branchId" TEXT,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodeLogo_key_key" ON "NodeLogo"("key");
CREATE UNIQUE INDEX "NodeLogo_ggbId_key" ON "NodeLogo"("ggbId");
CREATE UNIQUE INDEX "NodeLogo_groupId_key" ON "NodeLogo"("groupId");
CREATE UNIQUE INDEX "NodeLogo_bgId_key" ON "NodeLogo"("bgId");
CREATE UNIQUE INDEX "NodeLogo_branchId_key" ON "NodeLogo"("branchId");

-- AddForeignKey
ALTER TABLE "NodeLogo" ADD CONSTRAINT "NodeLogo_ggbId_fkey" FOREIGN KEY ("ggbId") REFERENCES "Ggb"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeLogo" ADD CONSTRAINT "NodeLogo_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeLogo" ADD CONSTRAINT "NodeLogo_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeLogo" ADD CONSTRAINT "NodeLogo_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
