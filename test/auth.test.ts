import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cloudflare:workers before importing index
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

const { default: worker } = await import("../src/index.js");

const BASE_ENV = {
  RACHIO_API_KEY: "test-api-key",
  RACHIO_API_BASE: "https://api.rach.io/1",
  RACHIO_CLOUD_BASE: "https://cloud-rest.rach.io",
  MAX_DAILY_CALLS: "1500",
  MAX_ZONE_DURATION: "10800",
  URL_SECRET: "a".repeat(64),
};

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("Authentication", () => {
  it("returns 401 when no secret provided", async () => {
    const req = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, BASE_ENV as any, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong secret provided", async () => {
    const req = new Request("https://example.com/mcp?secret=wrong", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await worker.fetch(req, BASE_ENV as any, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 when secret is close but not matching", async () => {
    const req = new Request(
      `https://example.com/mcp?secret=${"b".repeat(64)}`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    );
    const res = await worker.fetch(req, BASE_ENV as any, ctx);
    expect(res.status).toBe(401);
  });

  it("allows health check without auth", async () => {
    const req = new Request("https://example.com/health", { method: "GET" });
    const res = await worker.fetch(req, BASE_ENV as any, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths with valid auth", async () => {
    const req = new Request(
      `https://example.com/unknown?secret=${"a".repeat(64)}`,
      { method: "GET" }
    );
    const res = await worker.fetch(req, BASE_ENV as any, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when CF Access is configured but headers missing", async () => {
    const env = {
      ...BASE_ENV,
      CF_ACCESS_CLIENT_ID: "test-client-id",
      CF_ACCESS_CLIENT_SECRET: "test-client-secret",
    };
    const req = new Request(
      `https://example.com/mcp?secret=${"a".repeat(64)}`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    );
    const res = await worker.fetch(req, env as any, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 403 when CF Access headers are wrong", async () => {
    const env = {
      ...BASE_ENV,
      CF_ACCESS_CLIENT_ID: "test-client-id",
      CF_ACCESS_CLIENT_SECRET: "test-client-secret",
    };
    const req = new Request(
      `https://example.com/mcp?secret=${"a".repeat(64)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Access-Client-Id": "wrong-id",
          "CF-Access-Client-Secret": "wrong-secret",
        },
      }
    );
    const res = await worker.fetch(req, env as any, ctx);
    expect(res.status).toBe(403);
  });
});
