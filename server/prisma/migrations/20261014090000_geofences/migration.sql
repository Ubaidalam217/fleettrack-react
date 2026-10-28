-- CreateEnum
CREATE TYPE "GeofenceKind" AS ENUM ('GEOFENCE', 'ADDRESS');

-- CreateEnum
CREATE TYPE "GeofenceShape" AS ENUM ('POLYGON', 'CIRCLE');

-- CreateTable
CREATE TABLE "Geofence" (
    "id" TEXT NOT NULL,
    "bgId" TEXT NOT NULL,
    "kind" "GeofenceKind" NOT NULL,
    "shape" "GeofenceShape" NOT NULL,
    "name" TEXT NOT NULL,
    "points" JSONB,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "radius" DOUBLE PRECISION,
    "category" TEXT,
    "color" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Geofence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Geofence_bgId_idx" ON "Geofence"("bgId");

-- CreateIndex
CREATE UNIQUE INDEX "Geofence_bgId_name_key" ON "Geofence"("bgId", "name");

-- AddForeignKey
ALTER TABLE "Geofence" ADD CONSTRAINT "Geofence_bgId_fkey" FOREIGN KEY ("bgId") REFERENCES "BusinessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

