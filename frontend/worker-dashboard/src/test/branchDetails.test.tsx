import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BranchPage, { type BranchRecord } from "../Branch";

const branch: BranchRecord = {
  id: "lucifer",
  name: "Lucifer TEAM",
  description: "Наставничество и лучшие лендинги для новых участников.",
  percent: 10,
  members: 7,
  total: 1840,
  profitCount: 23,
  owner: { username: "Lucif3r_88", firstName: "Lucifer" },
  createdAt: "2026-08-01T00:00:00.000Z",
  acceptingApplications: true,
};

describe("branch details modal", () => {
  it("opens from a branch card, shows worker-facing details and closes with Escape", async () => {
    render(
      <BranchPage
        membership="none"
        initialBranches={[branch]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Подробнее о филиале Lucifer TEAM" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Lucifer TEAM" });
    const details = within(dialog);
    expect(dialog).toBeVisible();
    expect(details.getByText(branch.description)).toBeVisible();
    expect(details.getByText("$1,840")).toBeVisible();
    expect(details.getByText("23")).toBeVisible();
    expect(details.getByText("@Lucif3r_88")).toBeVisible();
    expect(details.getByRole("button", { name: "Подать заявку" })).toBeEnabled();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});
