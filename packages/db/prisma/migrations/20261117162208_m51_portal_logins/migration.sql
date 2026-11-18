







-- AlterTable
ALTER TABLE "students" ADD COLUMN     "user_id" UUID;

-- CreateIndex
CREATE INDEX "guardians_tenant_id_user_id_idx" ON "guardians"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_user_id_key" ON "students"("tenant_id", "user_id");

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- M5.1: parent and student logins point at real users (global table, no tenant column).
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
