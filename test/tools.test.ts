import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RachioClient } from "../src/rachio-client.js";
import { registerTools } from "../src/tools.js";

const mockEnv = {
  RACHIO_API_KEY: "test-api-key",
  RACHIO_API_BASE: "https://api.rach.io/1",
  RACHIO_CLOUD_BASE: "https://cloud-rest.rach.io",
  MAX_DAILY_CALLS: "1500",
  MAX_ZONE_DURATION: "10800",
  URL_SECRET: "test-secret",
};

describe("Tool registration", () => {
  it("registers all expected tools", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const client = new RachioClient(mockEnv as any);
    registerTools(server, client);

    const tools = (server as any)._registeredTools as Record<string, unknown>;

    const expectedTools = [
      // Read-only
      "get_person",
      "get_device",
      "get_device_state",
      "get_zone",
      "get_current_schedule",
      "get_schedule_rule",
      "get_flex_schedule",
      "get_forecast",
      "get_events",
      "get_webhooks",
      // Write
      "start_zone",
      "start_multiple_zones",
      "stop_water",
      "rain_delay",
      "set_moisture_percent",
      "skip_schedule",
      "start_schedule",
      "seasonal_adjustment",
      "skip_forward_zone_run",
      // Zone settings
      "update_zone",
      // Thresholds
      "update_location_threshold",
      // Device control
      "set_device_standby",
      // Watering history
      "get_watering_summary",
      "get_watering_summary_by_interval",
      // Schedule CRUD
      "preview_schedule",
      "create_schedule",
      "update_schedule",
      "delete_schedule",
      // Webhooks
      "create_webhook",
      "delete_webhook",
    ];

    for (const name of expectedTools) {
      expect(name in tools, `Missing tool: ${name}`).toBe(true);
    }

    expect(Object.keys(tools).length).toBe(expectedTools.length);
  });
});

describe("Confirmation guard", () => {
  let server: McpServer;
  let client: RachioClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    client = new RachioClient(mockEnv as any);
    registerTools(server, client);
  });

  it("start_zone returns preview when confirm is false", async () => {
    const tools = (server as any)._registeredTools as Record<string, any>;
    const tool = tools["start_zone"];
    const result = await tool.handler({
      zone_id: "zone-1",
      duration_seconds: 600,
      confirm: false,
    });
    expect(result.content[0].text).toContain("This will");
    expect(result.content[0].text).toContain("confirm: true");
  });

  it("stop_water returns preview when confirm is false", async () => {
    const tools = (server as any)._registeredTools as Record<string, any>;
    const tool = tools["stop_water"];
    const result = await tool.handler({
      device_id: "dev-1",
      confirm: false,
    });
    expect(result.content[0].text).toContain("This will");
  });

  it("delete_schedule returns preview when confirm is false", async () => {
    const tools = (server as any)._registeredTools as Record<string, any>;
    const tool = tools["delete_schedule"];
    const result = await tool.handler({
      schedule_id: "sched-1",
      confirm: false,
    });
    expect(result.content[0].text).toContain("permanently delete");
  });

  it("set_device_standby returns preview when confirm is false", async () => {
    const tools = (server as any)._registeredTools as Record<string, any>;
    const tool = tools["set_device_standby"];
    const result = await tool.handler({
      device_id: "dev-1",
      standby: true,
      confirm: false,
    });
    expect(result.content[0].text).toContain("standby");
  });

  it("update_zone returns preview when confirm is false", async () => {
    const tools = (server as any)._registeredTools as Record<string, any>;
    const tool = tools["update_zone"];
    const result = await tool.handler({
      zone_id: "zone-1",
      name: "New Name",
      confirm: false,
    });
    expect(result.content[0].text).toContain("This will");
    expect(result.content[0].text).toContain("name");
  });
});
