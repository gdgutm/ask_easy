// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Role, SessionStatus, Visibility, QuestionStatus } from "../generated/prisma";

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
// User Model
// =============================================================================
describe("User model", () => {
  it("creates a user with all fields", async () => {
    const user = await prisma.user.create({
      data: {
        utorid: "test001",
        email: "test@utoronto.ca",
        name: "Test User",
        role: Role.STUDENT,
      },
    });

    expect(user).toMatchObject({
      utorid: "test001",
      email: "test@utoronto.ca",
      name: "Test User",
      role: Role.STUDENT,
    });
    expect(user.id).toBeDefined();
  });

  it("defaults role to STUDENT", async () => {
    const user = await prisma.user.create({
      data: {
        utorid: "test002",
        email: "test2@utoronto.ca",
        name: "Default Role User",
      },
    });

    expect(user.role).toBe(Role.STUDENT);
  });

  it("supports all role values", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const ta = await prisma.user.create({
      data: { utorid: "t1", email: "t@test.ca", name: "TA", role: Role.TA },
    });
    const student = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student", role: Role.STUDENT },
    });

    expect(prof.role).toBe(Role.PROFESSOR);
    expect(ta.role).toBe(Role.TA);
    expect(student.role).toBe(Role.STUDENT);
  });

  it("enforces unique utorid", async () => {
    await prisma.user.create({
      data: { utorid: "dup001", email: "a@test.ca", name: "User A" },
    });

    await expect(
      prisma.user.create({
        data: { utorid: "dup001", email: "b@test.ca", name: "User B" },
      })
    ).rejects.toThrow();
  });

  it("enforces unique email", async () => {
    await prisma.user.create({
      data: { utorid: "u1", email: "dup@test.ca", name: "User A" },
    });

    await expect(
      prisma.user.create({
        data: { utorid: "u2", email: "dup@test.ca", name: "User B" },
      })
    ).rejects.toThrow();
  });
});

// =============================================================================
// Course Model
// =============================================================================
describe("Course model", () => {
  it("creates a course linked to a user", async () => {
    const user = await prisma.user.create({
      data: { utorid: "prof1", email: "prof@test.ca", name: "Prof", role: Role.PROFESSOR },
    });

    const course = await prisma.course.create({
      data: {
        code: "CSC108",
        name: "Intro to CS",
        semester: "Winter 2025",
        createdById: user.id,
      },
    });

    expect(course).toMatchObject({
      code: "CSC108",
      name: "Intro to CS",
      semester: "Winter 2025",
      createdById: user.id,
    });
  });
});

// =============================================================================
// CourseEnrollment Model
// =============================================================================
describe("CourseEnrollment model", () => {
  it("creates an enrollment linking user and course", async () => {
    const user = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student" },
    });
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });

    const enrollment = await prisma.courseEnrollment.create({
      data: { userId: user.id, courseId: course.id, role: Role.STUDENT },
    });

    expect(enrollment.userId).toBe(user.id);
    expect(enrollment.courseId).toBe(course.id);
    expect(enrollment.role).toBe(Role.STUDENT);
  });

  it("enforces unique userId + courseId constraint", async () => {
    const user = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student" },
    });
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });

    await prisma.courseEnrollment.create({
      data: { userId: user.id, courseId: course.id, role: Role.STUDENT },
    });

    await expect(
      prisma.courseEnrollment.create({
        data: { userId: user.id, courseId: course.id, role: Role.TA },
      })
    ).rejects.toThrow();
  });
});

// =============================================================================
// Session Model
// =============================================================================
describe("Session model", () => {
  it("creates a session with all fields", async () => {
    const user = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: user.id },
    });

    const session = await prisma.session.create({
      data: {
        courseId: course.id,
        createdById: user.id,
        title: "Lecture 1",
        joinCode: "ABC123",
        status: SessionStatus.ACTIVE,
        isSubmissionsEnabled: true,
        startTime: new Date("2025-01-15T10:00:00Z"),
      },
    });

    expect(session).toMatchObject({
      title: "Lecture 1",
      joinCode: "ABC123",
      status: SessionStatus.ACTIVE,
      isSubmissionsEnabled: true,
    });
    expect(session.createdAt).toBeDefined();
    expect(session.updatedAt).toBeDefined();
    expect(session.endTime).toBeNull();
  });

  it("defaults status to SCHEDULED and isSubmissionsEnabled to false", async () => {
    const user = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: user.id },
    });

    const session = await prisma.session.create({
      data: {
        courseId: course.id,
        createdById: user.id,
        title: "Lecture 1",
        joinCode: "DEF456",
      },
    });

    expect(session.status).toBe(SessionStatus.SCHEDULED);
    expect(session.isSubmissionsEnabled).toBe(false);
  });

  it("enforces unique joinCode", async () => {
    const user = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: user.id },
    });

    await prisma.session.create({
      data: {
        courseId: course.id,
        createdById: user.id,
        title: "Lecture 1",
        joinCode: "SAME_CODE",
      },
    });

    await expect(
      prisma.session.create({
        data: {
          courseId: course.id,
          createdById: user.id,
          title: "Lecture 2",
          joinCode: "SAME_CODE",
        },
      })
    ).rejects.toThrow();
  });

  it("supports all SessionStatus values", async () => {
    const user = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: user.id },
    });

    const scheduled = await prisma.session.create({
      data: {
        courseId: course.id,
        createdById: user.id,
        title: "S1",
        joinCode: "A1",
        status: SessionStatus.SCHEDULED,
      },
    });
    const active = await prisma.session.create({
      data: {
        courseId: course.id,
        createdById: user.id,
        title: "S2",
        joinCode: "A2",
        status: SessionStatus.ACTIVE,
      },
    });
    const ended = await prisma.session.create({
      data: {
        courseId: course.id,
        createdById: user.id,
        title: "S3",
        joinCode: "A3",
        status: SessionStatus.ENDED,
      },
    });

    expect(scheduled.status).toBe(SessionStatus.SCHEDULED);
    expect(active.status).toBe(SessionStatus.ACTIVE);
    expect(ended.status).toBe(SessionStatus.ENDED);
  });
});

// =============================================================================
// SlideSet Model
// =============================================================================
describe("SlideSet model", () => {
  it("creates a slide set linked to a session", async () => {
    const user = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: user.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: user.id, title: "L1", joinCode: "X1" },
    });

    const slideSet = await prisma.slideSet.create({
      data: {
        sessionId: session.id,
        filename: "lecture1.pdf",
        storageKey: "sessions/test/slides/test.pdf",
        pageCount: 10,
        fileSize: 1024000,
        uploadedBy: user.id,
      },
    });

    expect(slideSet).toMatchObject({
      sessionId: session.id,
      filename: "lecture1.pdf",
      storageKey: "sessions/test/slides/test.pdf",
      pageCount: 10,
      fileSize: 1024000,
      uploadedBy: user.id,
    });
  });
});

// =============================================================================
// Question Model
// =============================================================================
describe("Question model", () => {
  it("creates a question with all fields", async () => {
    const user = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student" },
    });
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });

    const question = await prisma.question.create({
      data: {
        sessionId: session.id,
        authorId: user.id,
        content: "How does this work?",
        isAnonymous: false,
        visibility: Visibility.PUBLIC,
        status: QuestionStatus.OPEN,
      },
    });

    expect(question).toMatchObject({
      sessionId: session.id,
      authorId: user.id,
      content: "How does this work?",
      isAnonymous: false,
      visibility: Visibility.PUBLIC,
      status: QuestionStatus.OPEN,
      upvoteCount: 0,
    });
    expect(question.createdAt).toBeDefined();
  });

  it("allows anonymous questions with null authorId", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });

    const question = await prisma.question.create({
      data: {
        sessionId: session.id,
        authorId: null,
        content: "Anonymous question",
        isAnonymous: true,
      },
    });

    expect(question.authorId).toBeNull();
    expect(question.isAnonymous).toBe(true);
  });

  it("supports all Visibility values", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });

    const pub = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1", visibility: Visibility.PUBLIC },
    });
    const instrOnly = await prisma.question.create({
      data: { sessionId: session.id, content: "Q2", visibility: Visibility.INSTRUCTOR_ONLY },
    });

    expect(pub.visibility).toBe(Visibility.PUBLIC);
    expect(instrOnly.visibility).toBe(Visibility.INSTRUCTOR_ONLY);
  });

  it("supports all QuestionStatus values", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });

    const open = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1", status: QuestionStatus.OPEN },
    });
    const answered = await prisma.question.create({
      data: { sessionId: session.id, content: "Q2", status: QuestionStatus.ANSWERED },
    });
    const resolved = await prisma.question.create({
      data: { sessionId: session.id, content: "Q3", status: QuestionStatus.RESOLVED },
    });

    expect(open.status).toBe(QuestionStatus.OPEN);
    expect(answered.status).toBe(QuestionStatus.ANSWERED);
    expect(resolved.status).toBe(QuestionStatus.RESOLVED);
  });
});

// =============================================================================
// Answer Model
// =============================================================================
describe("Answer model", () => {
  it("creates an answer linked to a question and author", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1" },
    });

    const answer = await prisma.answer.create({
      data: {
        questionId: question.id,
        authorId: prof.id,
        content: "Here is the answer.",
        isAccepted: true,
      },
    });

    expect(answer).toMatchObject({
      questionId: question.id,
      authorId: prof.id,
      content: "Here is the answer.",
      isAccepted: true,
    });
    expect(answer.createdAt).toBeDefined();
  });

  it("defaults isAccepted to false", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1" },
    });

    const answer = await prisma.answer.create({
      data: { questionId: question.id, authorId: prof.id, content: "Answer" },
    });

    expect(answer.isAccepted).toBe(false);
  });
});

// =============================================================================
// QuestionUpvote Model
// =============================================================================
describe("QuestionUpvote model", () => {
  it("creates an upvote linking question and user", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const student = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student" },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1" },
    });

    const upvote = await prisma.questionUpvote.create({
      data: { questionId: question.id, userId: student.id },
    });

    expect(upvote.questionId).toBe(question.id);
    expect(upvote.userId).toBe(student.id);
  });

  it("prevents duplicate upvotes (unique constraint on questionId + userId)", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const student = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student" },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1" },
    });

    await prisma.questionUpvote.create({
      data: { questionId: question.id, userId: student.id },
    });

    await expect(
      prisma.questionUpvote.create({
        data: { questionId: question.id, userId: student.id },
      })
    ).rejects.toThrow();
  });
});

// =============================================================================
// Relationship Queries
// =============================================================================
describe("Relationships", () => {
  it("queries user.enrollments.course", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const student = await prisma.user.create({
      data: { utorid: "s1", email: "s@test.ca", name: "Student" },
    });
    const course1 = await prisma.course.create({
      data: { code: "CSC108", name: "Intro to CS", semester: "W25", createdById: prof.id },
    });
    const course2 = await prisma.course.create({
      data: { code: "CSC148", name: "Data Structures", semester: "W25", createdById: prof.id },
    });

    await prisma.courseEnrollment.createMany({
      data: [
        { userId: student.id, courseId: course1.id, role: Role.STUDENT },
        { userId: student.id, courseId: course2.id, role: Role.STUDENT },
      ],
    });

    const result = await prisma.user.findUnique({
      where: { id: student.id },
      include: { enrollments: { include: { course: true } } },
    });

    expect(result!.enrollments).toHaveLength(2);
    const codes = result!.enrollments.map((e) => e.course.code).sort();
    expect(codes).toEqual(["CSC108", "CSC148"]);
  });

  it("queries question.answers.author", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const ta = await prisma.user.create({
      data: { utorid: "t1", email: "t@test.ca", name: "TA", role: Role.TA },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "How does this work?" },
    });

    await prisma.answer.create({
      data: { questionId: question.id, authorId: prof.id, content: "Like this.", isAccepted: true },
    });
    await prisma.answer.create({
      data: { questionId: question.id, authorId: ta.id, content: "Also this." },
    });

    const result = await prisma.question.findUnique({
      where: { id: question.id },
      include: { answers: { include: { author: true } } },
    });

    expect(result!.answers).toHaveLength(2);
    const authors = result!.answers.map((a) => a.author.name).sort();
    expect(authors).toEqual(["Prof", "TA"]);
  });

  it("queries course.sessions and session.slideSets", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });

    await prisma.slideSet.create({
      data: {
        sessionId: session.id,
        filename: "test.pdf",
        storageKey: "sessions/test/slides/test.pdf",
        pageCount: 2,
        fileSize: 1024,
        uploadedBy: prof.id,
      },
    });

    const result = await prisma.course.findUnique({
      where: { id: course.id },
      include: { sessions: { include: { slideSets: true } } },
    });

    expect(result!.sessions).toHaveLength(1);
    expect(result!.sessions[0].slideSets).toHaveLength(1);
  });

  it("queries question.session", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1" },
    });

    const result = await prisma.question.findUnique({
      where: { id: question.id },
      include: { session: true },
    });

    expect(result!.session.title).toBe("L1");
  });

  it("queries question.upvotes and upvote.user", async () => {
    const prof = await prisma.user.create({
      data: { utorid: "p1", email: "p@test.ca", name: "Prof", role: Role.PROFESSOR },
    });
    const s1 = await prisma.user.create({
      data: { utorid: "s1", email: "s1@test.ca", name: "Student 1" },
    });
    const s2 = await prisma.user.create({
      data: { utorid: "s2", email: "s2@test.ca", name: "Student 2" },
    });
    const course = await prisma.course.create({
      data: { code: "CSC108", name: "Intro", semester: "W25", createdById: prof.id },
    });
    const session = await prisma.session.create({
      data: { courseId: course.id, createdById: prof.id, title: "L1", joinCode: "X1" },
    });
    const question = await prisma.question.create({
      data: { sessionId: session.id, content: "Q1" },
    });

    await prisma.questionUpvote.createMany({
      data: [
        { questionId: question.id, userId: s1.id },
        { questionId: question.id, userId: s2.id },
      ],
    });

    const result = await prisma.question.findUnique({
      where: { id: question.id },
      include: { upvotes: { include: { user: true } } },
    });

    expect(result!.upvotes).toHaveLength(2);
    const names = result!.upvotes.map((u) => u.user.name).sort();
    expect(names).toEqual(["Student 1", "Student 2"]);
  });
});
