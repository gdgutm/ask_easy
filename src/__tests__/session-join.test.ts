// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Role, SessionStatus } from "../generated/prisma";
import { lookupSessionByCode, joinSession } from "@/lib/sessionJoin";
import { createSession } from "@/lib/sessionService";

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean all tables in dependency order
  await prisma.questionUpvote.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
  await prisma.slideSet.deleteMany();
  await prisma.session.deleteMany();
  await prisma.courseEnrollment.deleteMany();
  await prisma.course.deleteMany();
  await prisma.classlist.deleteMany();
  await prisma.user.deleteMany();
});

// =============================================================================
// Session Join Integration Tests
// =============================================================================
describe("Session Join Flow", () => {
  describe("Full flow: Professor creates session, student joins", () => {
    it("allows a student to join a session created by a professor", async () => {
      // 1. Create a professor user
      const professor = await prisma.user.create({
        data: {
          utorid: "prof001",
          email: "prof@utoronto.ca",
          name: "Professor Smith",
          role: Role.PROFESSOR,
        },
      });

      // 2. Create a student user
      const student = await prisma.user.create({
        data: {
          utorid: "student001",
          email: "student@utoronto.ca",
          name: "Student Jones",
          role: Role.STUDENT,
        },
      });

      // 3. Create a course
      const course = await prisma.course.create({
        data: {
          code: "CSC108",
          name: "Introduction to Computer Programming",
          semester: "Winter 2025",
          createdById: professor.id,
        },
      });

      // 4. Enroll professor in the course as PROFESSOR
      await prisma.courseEnrollment.create({
        data: {
          userId: professor.id,
          courseId: course.id,
          role: Role.PROFESSOR,
        },
      });

      // 5. Professor creates a session using the service
      const sessionResult = await createSession({
        courseId: course.id,
        title: "Lecture 1: Introduction to Python",
        userId: professor.id,
      });

      expect(sessionResult.success).toBe(true);
      expect(sessionResult.session).toBeDefined();
      expect(sessionResult.session!.joinCode).toBeDefined();

      const joinCode = sessionResult.session!.joinCode;

      // 6. Student looks up the session by join code
      const lookupResult = await lookupSessionByCode(joinCode);

      expect(lookupResult.success).toBe(true);
      expect(lookupResult.session).toBeDefined();
      expect(lookupResult.session!.title).toBe("Lecture 1: Introduction to Python");
      expect(lookupResult.session!.course.code).toBe("CSC108");

      // 7. Student joins the session
      const joinResult = await joinSession(joinCode, student.id);

      expect(joinResult.success).toBe(true);
      expect(joinResult.enrollment).toBeDefined();
      expect(joinResult.enrollment!.userId).toBe(student.id);
      expect(joinResult.enrollment!.courseId).toBe(course.id);
      expect(joinResult.enrollment!.role).toBe("STUDENT");

      // 8. Verify enrollment was created in database
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: {
            userId: student.id,
            courseId: course.id,
          },
        },
      });

      expect(enrollment).not.toBeNull();
      expect(enrollment!.role).toBe(Role.STUDENT);
    });

    it("supports case-insensitive join code lookup", async () => {
      const professor = await prisma.user.create({
        data: { utorid: "prof001", email: "prof@test.ca", name: "Prof", role: Role.PROFESSOR },
      });
      const course = await prisma.course.create({
        data: { code: "CSC108", name: "Intro", semester: "W25", createdById: professor.id },
      });
      await prisma.courseEnrollment.create({
        data: { userId: professor.id, courseId: course.id, role: Role.PROFESSOR },
      });

      const sessionResult = await createSession({
        courseId: course.id,
        title: "Test Session",
        userId: professor.id,
      });

      const joinCode = sessionResult.session!.joinCode;

      // Try lowercase
      const lowerResult = await lookupSessionByCode(joinCode.toLowerCase());
      expect(lowerResult.success).toBe(true);

      // Try uppercase
      const upperResult = await lookupSessionByCode(joinCode.toUpperCase());
      expect(upperResult.success).toBe(true);
    });
  });

  describe("Session lookup errors", () => {
    it("returns 404 for non-existent join code", async () => {
      const result = await lookupSessionByCode("NONEXISTENT");

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe("Session not found.");
    });
  });

  describe("Session join errors", () => {
    it("returns 404 when joining with non-existent code", async () => {
      const student = await prisma.user.create({
        data: { utorid: "s1", email: "s@test.ca", name: "Student" },
      });

      const result = await joinSession("NONEXISTENT", student.id);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe("Session not found.");
    });

    it("returns 409 when already enrolled in course", async () => {
      const professor = await prisma.user.create({
        data: { utorid: "prof001", email: "prof@test.ca", name: "Prof", role: Role.PROFESSOR },
      });
      const student = await prisma.user.create({
        data: { utorid: "student001", email: "student@test.ca", name: "Student" },
      });
      const course = await prisma.course.create({
        data: { code: "CSC108", name: "Intro", semester: "W25", createdById: professor.id },
      });

      // Professor enrolled
      await prisma.courseEnrollment.create({
        data: { userId: professor.id, courseId: course.id, role: Role.PROFESSOR },
      });

      // Student already enrolled
      await prisma.courseEnrollment.create({
        data: { userId: student.id, courseId: course.id, role: Role.STUDENT },
      });

      const sessionResult = await createSession({
        courseId: course.id,
        title: "Test Session",
        userId: professor.id,
      });

      const joinResult = await joinSession(sessionResult.session!.joinCode, student.id);

      expect(joinResult.success).toBe(false);
      expect(joinResult.statusCode).toBe(409);
      expect(joinResult.error).toBe("You are already enrolled in this course.");
    });

    it("returns 410 when session has ended", async () => {
      const professor = await prisma.user.create({
        data: { utorid: "prof001", email: "prof@test.ca", name: "Prof", role: Role.PROFESSOR },
      });
      const student = await prisma.user.create({
        data: { utorid: "student001", email: "student@test.ca", name: "Student" },
      });
      const course = await prisma.course.create({
        data: { code: "CSC108", name: "Intro", semester: "W25", createdById: professor.id },
      });

      await prisma.courseEnrollment.create({
        data: { userId: professor.id, courseId: course.id, role: Role.PROFESSOR },
      });

      // Create session directly with ENDED status
      const session = await prisma.session.create({
        data: {
          courseId: course.id,
          createdById: professor.id,
          title: "Ended Session",
          joinCode: "ENDED123",
          status: SessionStatus.ENDED,
        },
      });

      const joinResult = await joinSession(session.joinCode, student.id);

      expect(joinResult.success).toBe(false);
      expect(joinResult.statusCode).toBe(410);
      expect(joinResult.error).toBe("This session has ended.");
    });
  });

  describe("Professor session creation authorization", () => {
    it("prevents non-professors from creating sessions", async () => {
      const student = await prisma.user.create({
        data: { utorid: "student001", email: "student@test.ca", name: "Student" },
      });
      const professor = await prisma.user.create({
        data: { utorid: "prof001", email: "prof@test.ca", name: "Prof", role: Role.PROFESSOR },
      });
      const course = await prisma.course.create({
        data: { code: "CSC108", name: "Intro", semester: "W25", createdById: professor.id },
      });

      // Enroll student as STUDENT, not professor
      await prisma.courseEnrollment.create({
        data: { userId: student.id, courseId: course.id, role: Role.STUDENT },
      });

      const result = await createSession({
        courseId: course.id,
        title: "Test Session",
        userId: student.id,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.error).toBe("Only professors can create sessions.");
    });

    it("prevents unenrolled users from creating sessions", async () => {
      const prof1 = await prisma.user.create({
        data: { utorid: "prof001", email: "prof1@test.ca", name: "Prof 1", role: Role.PROFESSOR },
      });
      const prof2 = await prisma.user.create({
        data: { utorid: "prof002", email: "prof2@test.ca", name: "Prof 2", role: Role.PROFESSOR },
      });
      const course = await prisma.course.create({
        data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof1.id },
      });

      // prof1 is enrolled, but prof2 is not
      await prisma.courseEnrollment.create({
        data: { userId: prof1.id, courseId: course.id, role: Role.PROFESSOR },
      });

      const result = await createSession({
        courseId: course.id,
        title: "Test Session",
        userId: prof2.id,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.error).toBe("You are not enrolled in this course.");
    });
  });

  describe("Multiple students joining same session", () => {
    it("allows multiple students to join the same session", async () => {
      const professor = await prisma.user.create({
        data: { utorid: "prof001", email: "prof@test.ca", name: "Prof", role: Role.PROFESSOR },
      });
      const student1 = await prisma.user.create({
        data: { utorid: "student001", email: "s1@test.ca", name: "Student 1" },
      });
      const student2 = await prisma.user.create({
        data: { utorid: "student002", email: "s2@test.ca", name: "Student 2" },
      });
      const student3 = await prisma.user.create({
        data: { utorid: "student003", email: "s3@test.ca", name: "Student 3" },
      });

      const course = await prisma.course.create({
        data: { code: "CSC108", name: "Intro", semester: "W25", createdById: professor.id },
      });

      await prisma.courseEnrollment.create({
        data: { userId: professor.id, courseId: course.id, role: Role.PROFESSOR },
      });

      const sessionResult = await createSession({
        courseId: course.id,
        title: "Lecture 1",
        userId: professor.id,
      });

      const joinCode = sessionResult.session!.joinCode;

      // All students join
      const join1 = await joinSession(joinCode, student1.id);
      const join2 = await joinSession(joinCode, student2.id);
      const join3 = await joinSession(joinCode, student3.id);

      expect(join1.success).toBe(true);
      expect(join2.success).toBe(true);
      expect(join3.success).toBe(true);

      // Verify all enrollments exist
      const enrollments = await prisma.courseEnrollment.findMany({
        where: { courseId: course.id },
      });

      expect(enrollments).toHaveLength(4); // 1 professor + 3 students
    });
  });
});
