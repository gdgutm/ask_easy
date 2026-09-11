/**
 * Stress Test Seed Script
 *
 * Creates 100 student users, 1 professor, 1 classlist with 1 room, and 1 active session
 * for stress testing. Run with: pnpm run stress:seed
 */
import { PrismaClient, Role, SessionStatus } from "../src/generated/prisma";

const prisma = new PrismaClient();

const NUM_STUDENTS = 100;

function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function seed() {
  console.log("[stress-seed] Cleaning stress test data...");

  // Delete users matching the stress test naming pattern
  await prisma.answerUpvote.deleteMany();
  await prisma.questionUpvote.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
  await prisma.slideSet.deleteMany();
  await prisma.session.deleteMany({
    where: { course: { code: "STRESS101" } },
  });
  await prisma.courseEnrollment.deleteMany({
    where: { course: { code: "STRESS101" } },
  });
  await prisma.course.deleteMany({ where: { code: "STRESS101" } });
  await prisma.classlist.deleteMany({ where: { code: "STRESS101" } });
  await prisma.user.deleteMany({
    where: {
      utorid: {
        startsWith: "stress_",
      },
    },
  });

  console.log("[stress-seed] Creating professor...");
  const professor = await prisma.user.create({
    data: {
      utorid: "stress_prof",
      email: "stress_prof@mail.utoronto.ca",
      name: "Stress Test Professor",
      // Global roles are always STUDENT — being a professor is an enrollment.
      role: Role.STUDENT,
      hasLoggedIn: true,
    },
  });

  console.log("[stress-seed] Creating 100 students...");
  const studentData = Array.from({ length: NUM_STUDENTS }, (_, i) => ({
    utorid: `stress_student_${String(i).padStart(3, "0")}`,
    email: `stress_student_${String(i).padStart(3, "0")}@mail.utoronto.ca`,
    name: `Stress Student ${i}`,
    role: Role.STUDENT as Role,
  }));

  await prisma.user.createMany({ data: studentData });

  const students = await prisma.user.findMany({
    where: { utorid: { startsWith: "stress_student_" } },
    orderBy: { utorid: "asc" },
  });

  console.log("[stress-seed] Creating classlist STRESS101 and its one room...");
  const classlist = await prisma.classlist.create({
    data: {
      code: "STRESS101",
      semester: "Winter 2026",
      createdById: professor.id,
    },
  });

  // One room, run by the one professor — the same shape the app creates.
  const course = await prisma.course.create({
    data: {
      code: "STRESS101",
      name: "STRESS101",
      semester: "Winter 2026",
      createdById: professor.id,
      classlistId: classlist.id,
      professorId: professor.id,
    },
  });

  // Enroll professor
  await prisma.courseEnrollment.create({
    data: {
      userId: professor.id,
      courseId: course.id,
      role: Role.PROFESSOR,
    },
  });

  console.log("[stress-seed] Creating active session...");
  const session = await prisma.session.create({
    data: {
      courseId: course.id,
      createdById: professor.id,
      title: "Stress Test Lecture",
      joinCode: generateJoinCode(),
      status: SessionStatus.ACTIVE,
      isSubmissionsEnabled: true,
    },
  });

  // Pre-enroll all students so they can post questions / connect sockets
  console.log("[stress-seed] Enrolling all students...");
  await prisma.courseEnrollment.createMany({
    data: students.map((s) => ({
      userId: s.id,
      courseId: course.id,
      role: Role.STUDENT,
    })),
  });

  const result = {
    professorId: professor.id,
    professorUtorid: professor.utorid,
    courseId: course.id,
    sessionId: session.id,
    joinCode: session.joinCode,
    studentCount: students.length,
    students: students.map((s) => ({ id: s.id, utorid: s.utorid })),
  };

  // Write fixture data for the stress test runner
  const fs = await import("fs");
  const path = await import("path");
  const fixtureFile = path.join(__dirname, "fixtures.json");
  fs.writeFileSync(fixtureFile, JSON.stringify(result, null, 2));

  console.log(`[stress-seed] Done. Fixture data written to ${fixtureFile}`);
  console.log(`  Professor: ${professor.utorid}`);
  console.log(`  Students:  ${students.length}`);
  console.log(`  Course:    STRESS101`);
  console.log(`  Session:   ${session.id} (join code: ${session.joinCode})`);
}

seed()
  .catch((e) => {
    console.error("[stress-seed] Failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
