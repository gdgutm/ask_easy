import { prisma } from "@/lib/prisma";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/adminWhitelist";

// ---------------------------------------------------------------------------
// Classlist authorization
//
// Managing a classlist means touching every room on it at once — the roster,
// the professors, the code. That is an admin action, the same as creating one.
// A professor manages their own room through /api/courses/[courseId], never
// through here.
// ---------------------------------------------------------------------------

export interface ClasslistContext {
  user: AuthUser;
  classlist: { id: string; code: string; semester: string; createdById: string };
  roomIds: string[];
}

export type ClasslistAccess =
  | { ok: true; context: ClasslistContext }
  | { ok: false; error: string; status: number };

export async function requireClasslistAdmin(classlistId: string): Promise<ClasslistAccess> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Authentication required.", status: 401 };
  }

  if (!isAdmin(user.utorid)) {
    return { ok: false, error: "Only admins can manage a class.", status: 403 };
  }

  const classlist = await prisma.classlist.findUnique({
    where: { id: classlistId },
    select: { id: true, code: true, semester: true, createdById: true },
  });

  if (!classlist) {
    return { ok: false, error: "Class not found.", status: 404 };
  }

  const rooms = await prisma.course.findMany({
    where: { classlistId },
    select: { id: true },
  });

  return {
    ok: true,
    context: { user, classlist, roomIds: rooms.map((r) => r.id) },
  };
}
