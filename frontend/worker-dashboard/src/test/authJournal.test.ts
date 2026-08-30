import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAuthJournal, sitesApi } from "../sitesApi";

describe("authorization journal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T01:25:00.000Z"));
  });

  it("normalizes and sorts the raw UProject history response", () => {
    const result = normalizeAuthJournal({
      sessions: [
        {
          ip: "46.196.196.251",
          language: "Turkish",
          browser: "Edge",
          platform: "Windows",
          is_desktop: true,
          time_spent: 0,
          last_time_online: "2026-08-29T00:31:00.000Z",
          rows: [],
        },
        {
          ip: "182.189.94.18",
          language: "English",
          browser: "Safari",
          platform: "Apple",
          is_desktop: false,
          time_spent: 1,
          last_time_online: "2026-08-29T01:21:00.000Z",
          rows: [
            {
              action: "CredentialsIntroduced",
              data: ["mashabraza", "secret"],
              createdAt: "2026-08-29T01:18:41.000Z",
            },
            {
              action: "AuthSuccess",
              createdAt: "2026-08-29T01:20:13.000Z",
            },
          ],
        },
      ],
    });

    expect(result.sessions.map((row) => row.ip)).toEqual([
      "182.189.94.18",
      "46.196.196.251",
    ]);
    expect(result.sessions[0]).toMatchObject({
      os: "Apple",
      device: "Mobile",
      duration: "~ 1 минута",
      online: true,
    });
    expect(result.sessions[0].events?.[0]).toMatchObject({
      text: "Введены верные данные:",
      tag: "mashabraza:secret",
    });
    expect(result.sessions[0].events?.[1].tone).toBe("success");
  });

  it("requests the server journal route and surfaces request failures", async () => {
    const failure = new Error("network down");
    window.WorkerAPI = {
      get: vi.fn().mockRejectedValue(failure),
      post: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      bust: vi.fn(),
    };

    await expect(sitesApi.getLinkJournal?.(12, 34)).rejects.toBe(failure);
    expect(window.WorkerAPI.get).toHaveBeenCalledWith(
      "/sites/domains/12/links/34/journal",
      { force: true },
    );
  });
});
