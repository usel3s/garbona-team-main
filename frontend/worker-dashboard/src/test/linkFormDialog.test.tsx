import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkFormDialog } from "../components/sites/LinkFormDialog";
import type { SiteLink, SiteTemplate } from "../sitesTypes";

const templates: SiteTemplate[] = [
  { id: 1, name: "Falcons Case" },
  { id: 2, name: "Steam Login" },
];

const link: SiteLink = {
  id: 11,
  path: "312541325",
  windowType: "FakeWindow",
  template: 1,
  templateName: "Falcons Case",
  stats: { views: 0, clicks: 0, auths: 0, logs: 0, mafiles: 0 },
};

describe("LinkFormDialog nested pickers", () => {
  it("opens template and auth-window pickers with showModal so they stack above the editor", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");

    render(
      <LinkFormDialog
        open
        mode="edit"
        link={link}
        templates={templates}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Редактирование ссылки" })).toBeInTheDocument();
    const afterEditor = showModal.mock.calls.length;
    expect(afterEditor).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Falcons Case" }));
    expect(showModal.mock.calls.length).toBeGreaterThan(afterEditor);
    expect(screen.getByRole("heading", { name: "Выбор шаблона" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать шаблон" }));
    const afterTemplate = showModal.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Фейк окно" }));
    expect(showModal.mock.calls.length).toBeGreaterThan(afterTemplate);
    expect(screen.getByRole("heading", { name: "Окно авторизации" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Текущее окно" })).toBeVisible();
  });
});
