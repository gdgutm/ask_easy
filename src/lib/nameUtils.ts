/**
 * The last whitespace-separated part of a name: "Jane Nakamura" → "Nakamura".
 * Falls back to the whole string when there is only one part.
 *
 * Used only to pick a default room name for the admin who creates a classlist —
 * they are the one professor who never types a name for their own room. Every
 * other room's name is typed by the admin and stored on the room.
 */
export function surnameOf(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1];
}
