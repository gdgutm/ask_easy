export type RoomRole = "STUDENT" | "TA" | "PROFESSOR";

export interface RoomSummary {
  id: string;
  /** The room's name, as an admin set it. */
  label: string;
  code: string;
  role: RoomRole;
  professor: { name: string; utorid: string } | null;
  /** True when the viewer is this room's professor. */
  isMine: boolean;
  activeSession: { id: string; joinCode: string } | null;
}

export interface ClasslistSummary {
  id: string;
  code: string;
  semester: string;
  /** True for the admin who uploaded it — they get the manage controls. */
  isCreator: boolean;
  liveRoomCount: number;
  rooms: RoomSummary[];
}

/** Where the room page's title comes from: "CSC101 — Smith". */
export function roomTitle(classCode: string, roomLabel: string): string {
  return roomLabel ? `${classCode} — ${roomLabel}` : classCode;
}
