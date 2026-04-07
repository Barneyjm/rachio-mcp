import { describe, it, expect, vi, beforeEach } from "vitest";
import { RachioClient } from "../src/rachio-client.js";

const mockEnv = {
  RACHIO_API_KEY: "test-api-key",
  RACHIO_API_BASE: "https://api.rach.io/1",
  RACHIO_CLOUD_BASE: "https://cloud-rest.rach.io",
  MAX_DAILY_CALLS: "1500",
  MAX_ZONE_DURATION: "10800",
  URL_SECRET: "test-secret",
};

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function mockFetchError(text: string, status: number) {
  return vi.fn().mockResolvedValue(
    new Response(text, { status, headers: { "Content-Type": "text/plain" } })
  );
}

describe("RachioClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getPerson", () => {
    it("chains /person/info then /person/{id}", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "person-123" }), {
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ id: "person-123", devices: [{ id: "device-1" }] }),
            { headers: { "Content-Type": "application/json" } }
          )
        );

      const client = new RachioClient(mockEnv as any);
      const result = await client.getPerson();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://api.rach.io/1/public/person/info"
      );
      expect(fetchSpy.mock.calls[1][0]).toBe(
        "https://api.rach.io/1/public/person/person-123"
      );
      expect(result).toEqual({ id: "person-123", devices: [{ id: "device-1" }] });
    });
  });

  describe("getDevice", () => {
    it("calls correct URL with auth header", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "dev-1", status: "ONLINE" }), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.getDevice("dev-1");

      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://api.rach.io/1/public/device/dev-1"
      );
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-api-key"
      );
    });
  });

  describe("getDeviceState", () => {
    it("uses cloud-rest base URL", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ state: "idle" }), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.getDeviceState("dev-1");

      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://cloud-rest.rach.io/device/getDeviceState/dev-1"
      );
    });
  });

  describe("startZone", () => {
    it("caps duration at MAX_ZONE_DURATION", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.startZone("zone-1", 99999);

      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.duration).toBe(10800);
    });

    it("uses PUT method", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.startZone("zone-1", 600);

      expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    });
  });

  describe("startMultipleZones", () => {
    it("caps each zone duration individually", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.startMultipleZones([
        { id: "z1", duration: 99999, sortOrder: 1 },
        { id: "z2", duration: 300, sortOrder: 2 },
      ]);

      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.zones[0].duration).toBe(10800);
      expect(body.zones[1].duration).toBe(300);
    });
  });

  describe("setMoisturePercent", () => {
    it("converts decimal to integer percent with correct field name", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.setMoisturePercent("zone-1", 0.75);

      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.percent).toBe(75);
      expect(body.moisture).toBeUndefined();
    });
  });

  describe("rainDelay", () => {
    it("sends expiration timestamp to cloud-rest", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.rainDelay("dev-1", "2026-04-09T12:00:00.000Z");

      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://cloud-rest.rach.io/device/setRainDelay"
      );
      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.device_id).toBe("dev-1");
      expect(body.rain_delay_expiration).toBe("2026-04-09T12:00:00.000Z");
    });
  });

  describe("updateZone", () => {
    it("wraps values in {value: ...} objects", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.updateZone("zone-1", {
        name: "Front Lawn",
        soil_type: "CLAY",
        nozzle_type: "DRIPLINE",
      });

      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.zone_id).toBe("zone-1");
      expect(body.name).toBe("Front Lawn");
      expect(body.soil_type).toEqual({ value: "CLAY" });
      expect(body.nozzle_type).toEqual({ value: "DRIPLINE" });
      expect(body.crop_type).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws on 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401 })
      );

      const client = new RachioClient(mockEnv as any);
      await expect(client.getDevice("dev-1")).rejects.toThrow(
        "Rachio API authentication failed"
      );
    });

    it("throws on 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not found", { status: 404 })
      );

      const client = new RachioClient(mockEnv as any);
      await expect(client.getDevice("bad-id")).rejects.toThrow(
        "Resource not found"
      );
    });

    it("throws on 429 with rate limit info", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Too many requests", { status: 429 })
      );

      const client = new RachioClient(mockEnv as any);
      await expect(client.getDevice("dev-1")).rejects.toThrow("Rachio rate limited");
    });

    it("throws on 500 with status and body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Internal error", { status: 500 })
      );

      const client = new RachioClient(mockEnv as any);
      await expect(client.getDevice("dev-1")).rejects.toThrow(
        "Rachio API error 500: Internal error"
      );
    });
  });

  describe("rate limiting", () => {
    it("works without RATE_LIMITER configured", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "dev-1" }), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      const result = await client.getDevice("dev-1");
      expect(result).toEqual({ id: "dev-1" });
    });

    it("getRateLimitInfo returns defaults without DO", async () => {
      const client = new RachioClient(mockEnv as any);
      const info = await client.getRateLimitInfo();
      expect(info.count).toBe(0);
      expect(info.limit).toBe(1500);
      expect(info.remaining).toBe(1500);
    });
  });

  describe("deleteSchedule", () => {
    it("URL-encodes the schedule ID", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const client = new RachioClient(mockEnv as any);
      await client.deleteSchedule("id/with/slashes");

      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://cloud-rest.rach.io/schedule/deleteSchedule/id%2Fwith%2Fslashes"
      );
    });
  });
});
