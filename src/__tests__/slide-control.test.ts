// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { PrismaClient, Role, SessionStatus } from "../generated/prisma";
import {
  requireSocketProfessor,
  requireSocketProfessorOrTA,
  NotEnrolledError,
  NotInstructorError,
  SessionNotFoundError,
} from "@/lib/sessionService";

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
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

/** A room with a professor, a TA, a student, and an outsider with no enrollment. */
async function buildRoom() {
  const make = (utorid: string, name: string) =>
    prisma.user.create({
      data: { utorid, email: `${utorid}@utoronto.ca`, name, role: Role.STUDENT },
    });

  const professor = await make("slideprof", "Jane Nakamura");
  const ta = await make("slideta", "Tomas Alvarez");
  const student = await make("slidestu", "Sam Reyes");
  const outsider = await make("slideout", "Nobody Here");

  const room = await prisma.course.create({
    data: {
      code: "SLD101",
      name: "Nakamura",
      semester: "Fall 2026",
      createdById: professor.id,
      professorId: professor.id,
    },
  });

  await prisma.courseEnrollment.createMany({
    data: [
      { userId: professor.id, courseId: room.id, role: Role.PROFESSOR },
      { userId: ta.id, courseId: room.id, role: Role.TA },
      { userId: student.id, courseId: room.id, role: Role.STUDENT },
    ],
  });

  const session = await prisma.session.create({
    data: {
      courseId: room.id,
      createdById: professor.id,
      title: "SLD101 — Nakamura",
      joinCode: "SLIDE1",
      status: SessionStatus.ACTIVE,
    },
  });

  return { professor, ta, student, outsider, room, session };
}

// =============================================================================
// Who may drive the shared deck
// =============================================================================
describe("Slide control authorization", () => {
  describe("requireSocketProfessorOrTA — moving the shared slides", () => {
    it("lets the room's professor drive", async () => {
      const { professor, room, session } = await buildRoom();
      const result = await requireSocketProfessorOrTA(professor.id, session.id);
      expect(result.role).toBe(Role.PROFESSOR);
      expect(result.courseId).toBe(room.id);
    });

    it("lets a TA of the room drive", async () => {
      const { ta, room, session } = await buildRoom();
      const result = await requireSocketProfessorOrTA(ta.id, session.id);
      expect(result.role).toBe(Role.TA);
      expect(result.courseId).toBe(room.id);
    });

    it("refuses a student", async () => {
      const { student, session } = await buildRoom();
      await expect(requireSocketProfessorOrTA(student.id, session.id)).rejects.toBeInstanceOf(
        NotInstructorError
      );
    });

    it("refuses someone with no enrollment in the room", async () => {
      const { outsider, session } = await buildRoom();
      await expect(requireSocketProfessorOrTA(outsider.id, session.id)).rejects.toBeInstanceOf(
        NotEnrolledError
      );
    });

    it("refuses a TA of a different room", async () => {
      const { ta, professor } = await buildRoom();

      const otherRoom = await prisma.course.create({
        data: {
          code: "SLD101",
          name: "Haddad",
          semester: "Fall 2026",
          createdById: professor.id,
          professorId: professor.id,
        },
      });
      const otherSession = await prisma.session.create({
        data: {
          courseId: otherRoom.id,
          createdById: professor.id,
          title: "SLD101 — Haddad",
          joinCode: "SLIDE2",
          status: SessionStatus.ACTIVE,
        },
      });

      // Being a TA next door grants nothing here — slide control is per room.
      await expect(requireSocketProfessorOrTA(ta.id, otherSession.id)).rejects.toBeInstanceOf(
        NotEnrolledError
      );
    });

    it("reports a missing session distinctly from a refusal", async () => {
      const { professor } = await buildRoom();
      await expect(
        requireSocketProfessorOrTA(professor.id, "no-such-session")
      ).rejects.toBeInstanceOf(SessionNotFoundError);
    });
  });

  describe("requireSocketProfessor — uploading and ending", () => {
    it("lets the room's professor through", async () => {
      const { professor, room, session } = await buildRoom();
      const result = await requireSocketProfessor(professor.id, session.id);
      expect(result.courseId).toBe(room.id);
    });

    it("refuses a TA — uploading the deck is not theirs to do", async () => {
      const { ta, session } = await buildRoom();
      await expect(requireSocketProfessor(ta.id, session.id)).rejects.toBeInstanceOf(
        NotInstructorError
      );
    });

    it("refuses a student", async () => {
      const { student, session } = await buildRoom();
      await expect(requireSocketProfessor(student.id, session.id)).rejects.toBeInstanceOf(
        NotInstructorError
      );
    });
  });
});
