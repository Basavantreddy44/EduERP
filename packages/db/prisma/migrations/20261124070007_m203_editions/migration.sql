-- Phase 20 Editions (CD-125): each institution has an edition. Existing institutions are STANDARD.
ALTER TABLE "tenants" ADD COLUMN "edition" VARCHAR(20) NOT NULL DEFAULT 'STANDARD';

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_edition_chk" CHECK ("edition" IN ('STANDARD', 'RESIDENTIAL'));
