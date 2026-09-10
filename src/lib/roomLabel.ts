// ---------------------------------------------------------------------------
// Room labels
//
// A room is labelled by its professor's surname alone — "Smith", never
// "John Smith". The label is derived from User.name at read time rather than
// stored, so it corrects itself when a professor signs in for the first time
// and their placeholder name is replaced by the real one.
// ---------------------------------------------------------------------------

export interface RoomProfessor {
  id: string;
  name: string;
  utorid: string;
}

/**
 * The last whitespace-separated part of a name.
 * Falls back to the whole string when there is only one part.
 */
export function surnameOf(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1];
}

/** First initial with a period: "John Smith" → "J." Empty when there is no given name. */
function givenInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  return `${parts[0][0].toUpperCase()}.`;
}

/**
 * Labels for every professor on one classlist, keyed by user id.
 *
 * Surnames alone are ambiguous the moment a classlist has two professors named
 * Smith, so colliding surnames gain a first initial ("J. Smith"), and a
 * still-colliding pair falls back to the UTORid — which is unique by
 * definition. Professors whose surnames are unique are never decorated.
 */
export function roomLabelsFor(professors: RoomProfessor[]): Map<string, string> {
  const bySurname = new Map<string, RoomProfessor[]>();
  for (const prof of professors) {
    const surname = surnameOf(prof.name) || prof.utorid;
    const group = bySurname.get(surname);
    if (group) group.push(prof);
    else bySurname.set(surname, [prof]);
  }

  const labels = new Map<string, string>();
  for (const [surname, group] of bySurname) {
    if (group.length === 1) {
      labels.set(group[0].id, surname);
      continue;
    }

    const withInitial = group.map((prof) => {
      const initial = givenInitial(prof.name);
      return { prof, label: initial ? `${initial} ${surname}` : surname };
    });

    const counts = new Map<string, number>();
    for (const { label } of withInitial) counts.set(label, (counts.get(label) ?? 0) + 1);

    for (const { prof, label } of withInitial) {
      labels.set(prof.id, counts.get(label)! > 1 ? `${surname} (${prof.utorid})` : label);
    }
  }

  return labels;
}
