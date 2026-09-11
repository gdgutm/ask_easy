-- Classlists and per-professor rooms.
--
-- A Course row is now a *room*: one professor's space inside a Classlist.
-- Existing courses become single-room classlists so nothing is orphaned.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "hasLoggedIn" BOOLEAN NOT NULL DEFAULT false;

-- Everyone already in the table got there either by signing in or by being on
-- an uploaded roster. Assume the former where the name is not just the UTORid.
UPDATE "User" SET "hasLoggedIn" = true WHERE "name" <> "utorid";

-- CreateTable
CREATE TABLE "Classlist" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Classlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Classlist_createdById_idx" ON "Classlist"("createdById");
CREATE INDEX "Classlist_semester_idx" ON "Classlist"("semester");

-- AddForeignKey
ALTER TABLE "Classlist" ADD CONSTRAINT "Classlist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "classlistId" TEXT;
ALTER TABLE "Course" ADD COLUMN "professorId" TEXT;

-- CreateIndex
CREATE INDEX "Course_classlistId_idx" ON "Course"("classlistId");
CREATE INDEX "Course_professorId_idx" ON "Course"("professorId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_classlistId_fkey" FOREIGN KEY ("classlistId") REFERENCES "Classlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Course" ADD CONSTRAINT "Course_professorId_fkey" FOREIGN KEY ("professorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: give every existing course a classlist of its own, and make its
-- creator the room's professor.
INSERT INTO "Classlist" ("id", "code", "semester", "createdById", "createdAt", "updatedAt")
SELECT "id", "code", "semester", "createdById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Course";

UPDATE "Course" SET "classlistId" = "id", "professorId" = "createdById";

-- A room has exactly one professor. Courses created under the old co-professor
-- model can have several, so demote everyone who is not the room's professor.
UPDATE "CourseEnrollment" e
SET "role" = 'TA'
FROM "Course" c
WHERE e."courseId" = c."id"
  AND e."role" = 'PROFESSOR'
  AND e."userId" <> c."professorId";

-- The room's professor must actually be enrolled as one — a course whose
-- creator was never enrolled would otherwise end up with no professor at all.
INSERT INTO "CourseEnrollment" ("id", "userId", "courseId", "role")
SELECT md5(random()::text || clock_timestamp()::text), c."professorId", c."id", 'PROFESSOR'
FROM "Course" c
WHERE c."professorId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "CourseEnrollment" e
    WHERE e."courseId" = c."id" AND e."userId" = c."professorId"
  );

UPDATE "CourseEnrollment" e
SET "role" = 'PROFESSOR'
FROM "Course" c
WHERE e."courseId" = c."id" AND e."userId" = c."professorId" AND e."role" <> 'PROFESSOR';

-- Enforce the invariant from here on. Prisma cannot express a partial unique
-- index, so it lives in SQL: a second PROFESSOR enrollment on a room fails.
CREATE UNIQUE INDEX "CourseEnrollment_one_professor_per_course"
    ON "CourseEnrollment" ("courseId")
    WHERE "role" = 'PROFESSOR';
