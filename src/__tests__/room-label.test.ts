import { describe, expect, it } from "vitest";

import { roomLabelsFor, surnameOf, type RoomProfessor } from "@/lib/roomLabel";

const prof = (id: string, name: string, utorid: string): RoomProfessor => ({ id, name, utorid });

describe("surnameOf", () => {
  it("returns the last part of a name", () => {
    expect(surnameOf("John Smith")).toBe("Smith");
    expect(surnameOf("Maria del Carmen Rodriguez")).toBe("Rodriguez");
  });

  it("returns a single-part name unchanged", () => {
    expect(surnameOf("Prince")).toBe("Prince");
    expect(surnameOf("smithj")).toBe("smithj");
  });

  it("tolerates padding and repeated spaces", () => {
    expect(surnameOf("  John   Smith  ")).toBe("Smith");
  });

  it("returns an empty string for a missing name", () => {
    expect(surnameOf("")).toBe("");
    expect(surnameOf(null)).toBe("");
    expect(surnameOf(undefined)).toBe("");
  });
});

describe("roomLabelsFor", () => {
  it("uses the bare surname when it is unique", () => {
    const labels = roomLabelsFor([
      prof("1", "John Smith", "smithj"),
      prof("2", "Ada Lovelace", "lovea"),
    ]);
    expect(labels.get("1")).toBe("Smith");
    expect(labels.get("2")).toBe("Lovelace");
  });

  it("adds a first initial when two professors share a surname", () => {
    const labels = roomLabelsFor([
      prof("1", "John Smith", "smithj"),
      prof("2", "Ada Smith", "smitha"),
      prof("3", "Ada Lovelace", "lovea"),
    ]);
    expect(labels.get("1")).toBe("J. Smith");
    expect(labels.get("2")).toBe("A. Smith");
    // Unaffected by the collision next to it.
    expect(labels.get("3")).toBe("Lovelace");
  });

  it("falls back to the UTORid when the initial does not separate them", () => {
    const labels = roomLabelsFor([
      prof("1", "John Smith", "smithj"),
      prof("2", "Jane Smith", "smithj2"),
    ]);
    expect(labels.get("1")).toBe("Smith (smithj)");
    expect(labels.get("2")).toBe("Smith (smithj2)");
  });

  it("labels a placeholder single-word name by the word itself", () => {
    const labels = roomLabelsFor([prof("1", "smithj", "smithj")]);
    expect(labels.get("1")).toBe("smithj");
  });

  it("uses the UTORid when there is no name at all", () => {
    const labels = roomLabelsFor([prof("1", "", "smithj")]);
    expect(labels.get("1")).toBe("smithj");
  });

  it("returns an empty map for no professors", () => {
    expect(roomLabelsFor([]).size).toBe(0);
  });
});
