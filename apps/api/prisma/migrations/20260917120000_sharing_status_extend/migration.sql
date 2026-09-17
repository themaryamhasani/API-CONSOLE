-- Align catalog.SharingStatus with API Console sharing lifecycle values.
ALTER TYPE "catalog"."SharingStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "catalog"."SharingStatus" ADD VALUE IF NOT EXISTS 'DEPRECATED';
ALTER TYPE "catalog"."SharingStatus" ADD VALUE IF NOT EXISTS 'UNLISTED';
ALTER TYPE "catalog"."SharingStatus" ADD VALUE IF NOT EXISTS 'REMOVED';
