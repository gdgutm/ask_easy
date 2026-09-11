import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import PreviewClass from "@/app/create-class/components/PreviewClass";
import { emptyProfessorRow } from "@/app/create-class/components/ProfessorList";
import type { StudentRecord } from "@/utils/types";

function students(n: number): StudentRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    givenName: `Given${i + 1}`,
    surname: `Sur${i + 1}`,
    utorid: `stu${i + 1}`,
  }));
}

function renderPreview(count: number) {
  return render(
    <PreviewClass
      file={new File(["a"], "roster.csv", { type: "text/csv" })}
      processedData={{ courseCode: "TES101", students: students(count) }}
      onClear={vi.fn()}
      onSubmit={vi.fn()}
      professorRows={[emptyProfessorRow()]}
      onProfessorRowsChange={vi.fn()}
      tasInput=""
      onTasChange={vi.fn()}
      courseCodeInput="TES101"
      onCourseCodeChange={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe("PreviewClass roster pagination", () => {
  test("pages through every student", () => {
    renderPreview(5);

    expect(screen.getByText("1–4 of 5 students")).toBeTruthy();
    expect(screen.getByText("Given1")).toBeTruthy();
    expect(screen.getByText("Given4")).toBeTruthy();
    expect(screen.queryByText("Given5")).toBeNull();

    fireEvent.click(screen.getByLabelText("Next students"));

    expect(screen.getByText("5–5 of 5 students")).toBeTruthy();
    expect(screen.getByText("Given5")).toBeTruthy();
    expect(screen.queryByText("Given1")).toBeNull();

    fireEvent.click(screen.getByLabelText("Previous students"));
    expect(screen.getByText("Given1")).toBeTruthy();
  });

  test("disables the arrows at each end", () => {
    renderPreview(5);
    const prev = screen.getByLabelText("Previous students") as HTMLButtonElement;
    const next = screen.getByLabelText("Next students") as HTMLButtonElement;

    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  test("shows the page counter", () => {
    renderPreview(9);
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next students"));
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  test("keeps the table four rows tall on a short last page", () => {
    const { container } = renderPreview(5);
    const rowCount = () => container.querySelectorAll("tbody tr").length;

    expect(rowCount()).toBe(4);
    fireEvent.click(screen.getByLabelText("Next students"));
    // One student plus three spacers — the card must not shrink.
    expect(rowCount()).toBe(4);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]').length).toBe(3);
  });

  test("hides the controls when everyone already fits", () => {
    renderPreview(4);
    expect(screen.queryByLabelText("Next students")).toBeNull();
    expect(screen.queryByText(/of 4 students/)).toBeNull();
    expect(screen.getByText("Given4")).toBeTruthy();
  });
});
