import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ClassBrowser from "@/app/components/ClassBrowser";
import type { ClasslistSummary } from "@/app/components/classTypes";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

function classlist(overrides: Partial<ClasslistSummary> = {}): ClasslistSummary {
  return {
    id: "cl1",
    code: "TES101",
    semester: "Fall 2026",
    isCreator: false,
    liveRoomCount: 0,
    rooms: [],
    ...overrides,
  };
}

function mockClasslists(classlists: ClasslistSummary[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (String(input).startsWith("/api/classlists")) {
        return { ok: true, json: async () => ({ classlists }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    })
  );
}

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClassBrowser", () => {
  test("shows one card per class, not per room", async () => {
    mockClasslists([
      classlist({
        rooms: [
          {
            id: "r1",
            label: "Smith",
            code: "TES101",
            role: "STUDENT",
            professor: { name: "Jane Smith", utorid: "smithj", hasLoggedIn: true },
            isMine: false,
            activeSession: null,
          },
          {
            id: "r2",
            label: "Haddad",
            code: "TES101",
            role: "STUDENT",
            professor: { name: "Omar Haddad", utorid: "haddado", hasLoggedIn: true },
            isMine: false,
            activeSession: null,
          },
        ],
      }),
    ]);

    render(<ClassBrowser isAdmin={false} />);

    expect(await screen.findByText("TES101")).toBeTruthy();
    expect(screen.getByText("2 rooms")).toBeTruthy();
    // The rooms are behind the drill-down, not on the class card.
    expect(screen.queryByText("Smith")).toBeNull();
  });

  test("opening a class reveals its rooms and a way back", async () => {
    mockClasslists([
      classlist({
        liveRoomCount: 1,
        rooms: [
          {
            id: "r1",
            label: "Smith",
            code: "TES101",
            role: "STUDENT",
            professor: { name: "Jane Smith", utorid: "smithj", hasLoggedIn: true },
            isMine: false,
            activeSession: { id: "s1", joinCode: "ABC123" },
          },
          {
            id: "r2",
            label: "Haddad",
            code: "TES101",
            role: "STUDENT",
            professor: { name: "Omar Haddad", utorid: "haddado", hasLoggedIn: true },
            isMine: false,
            activeSession: null,
          },
        ],
      }),
    ]);

    render(<ClassBrowser isAdmin={false} />);
    fireEvent.click(await screen.findByText("TES101"));

    expect(screen.getByText("Smith")).toBeTruthy();
    expect(screen.getByText("Haddad")).toBeTruthy();
    // Live room offers Join; the other says so plainly.
    expect(screen.getByRole("button", { name: /join/i })).toBeTruthy();
    expect(screen.getByText("Not live right now")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /all classes/i }));
    expect(screen.getByText("2 rooms")).toBeTruthy();
  });

  test("a professor's own room offers Start Live Session, not Join", async () => {
    mockClasslists([
      classlist({
        rooms: [
          {
            id: "r1",
            label: "Smith",
            code: "TES101",
            role: "PROFESSOR",
            professor: { name: "Jane Smith", utorid: "smithj", hasLoggedIn: true },
            isMine: true,
            activeSession: null,
          },
        ],
      }),
    ]);

    render(<ClassBrowser isAdmin={false} />);
    fireEvent.click(await screen.findByText("TES101"));

    expect(screen.getByRole("button", { name: /start live session/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^join$/i })).toBeNull();
    expect(screen.getByText("Your room")).toBeTruthy();
  });

  test("flags a room whose professor has not signed in yet", async () => {
    mockClasslists([
      classlist({
        rooms: [
          {
            id: "r1",
            label: "Smith",
            code: "TES101",
            role: "STUDENT",
            professor: { name: "Jane Smith", utorid: "smithj", hasLoggedIn: false },
            isMine: false,
            activeSession: null,
          },
        ],
      }),
    ]);

    render(<ClassBrowser isAdmin={false} />);
    fireEvent.click(await screen.findByText("TES101"));

    expect(screen.getByText(/Temporary name/)).toBeTruthy();
  });

  test("only the class creator gets the manage control", async () => {
    mockClasslists([
      classlist({ isCreator: false }),
      classlist({ id: "cl2", code: "TES202", isCreator: true }),
    ]);

    render(<ClassBrowser isAdmin />);

    await screen.findByText("TES101");
    expect(screen.queryByLabelText("Manage TES101")).toBeNull();
    expect(screen.getByLabelText("Manage TES202")).toBeTruthy();
  });

  test("a class deleted elsewhere drops the drill-down instead of blanking", async () => {
    let current: ClasslistSummary[] = [
      classlist({
        rooms: [
          {
            id: "r1",
            label: "Smith",
            code: "TES101",
            role: "STUDENT",
            professor: { name: "Jane Smith", utorid: "smithj", hasLoggedIn: true },
            isMine: false,
            activeSession: null,
          },
        ],
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ classlists: current }) }) as Response)
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<ClassBrowser isAdmin={false} />);
    fireEvent.click(await screen.findByText("TES101"));
    expect(screen.getByText("Smith")).toBeTruthy();

    current = [];
    await vi.advanceTimersByTimeAsync(8000);

    await waitFor(() => expect(screen.getByText("No Classes Found")).toBeTruthy());
    vi.useRealTimers();
  });

  test("tells an admin with nothing how to start", async () => {
    mockClasslists([]);
    render(<ClassBrowser isAdmin />);
    expect(await screen.findByText("No Classes Yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /create a classlist/i })).toBeTruthy();
  });

  test("does not offer a non-admin a way to create one", async () => {
    mockClasslists([]);
    render(<ClassBrowser isAdmin={false} />);
    expect(await screen.findByText("No Classes Found")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /create/i })).toBeNull();
  });
});
