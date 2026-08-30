import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddDomainDialog } from "../components/sites/AddDomainDialog";

describe("AddDomainDialog Cloudflare step", () => {
  it("lets the worker pick Cloudflare and shows NS records", async () => {
    const onPrepare = vi.fn().mockResolvedValue({
      ip: "192.162.199.140",
      ns: ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AddDomainDialog
        open
        onClose={() => undefined}
        onPrepare={onPrepare}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "shop.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByRole("heading", { name: "Выберите способ привязки" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cloudflare" }));
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(await screen.findByDisplayValue("darwin.ns.cloudflare.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("maeve.ns.cloudflare.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Добавить домен" }));
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        domain: "shop.test",
        bindType: "cloudflare",
        isTransit: false,
      }),
    );
  });

  it("opens an existing team domain without forcing the bind wizard", async () => {
    const onPrepare = vi.fn().mockResolvedValue({ existing: true });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AddDomainDialog
        open
        onClose={() => undefined}
        onPrepare={onPrepare}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "https://www.team.test/path?q=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    await vi.waitFor(() => {
      expect(onPrepare).toHaveBeenCalledWith("team.test");
      expect(onSubmit).toHaveBeenCalledWith({ domain: "team.test" });
    });
    expect(
      await screen.findByRole("heading", { name: "Информация" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Домен уже есть в списке — открываю")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cloudflare" })).not.toBeInTheDocument();
  });
});
