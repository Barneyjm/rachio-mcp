import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  server.prompt(
    "irrigation_status",
    "Summarize current irrigation status, active schedules, upcoming weather, and alerts",
    { device_id: z.string().describe("Rachio device ID") },
    async ({ device_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Please provide a comprehensive irrigation status report for Rachio device ${device_id}.`,
              "",
              "Include:",
              "1. Current device status (online/offline, currently watering?)",
              "2. Active zone details if watering is in progress",
              "3. Upcoming scheduled runs",
              "4. Weather forecast summary (next 3 days) with precipitation probability",
              "5. Any recent alerts or skip events",
              "",
              "Use the get_device, get_device_state, get_current_schedule, get_forecast, and get_events tools to gather this information.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "zone_health_check",
    "Analyze zone health using valve monitoring, soil moisture, and watering history",
    { device_id: z.string().describe("Rachio device ID") },
    async ({ device_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Please perform a health check on all zones for Rachio device ${device_id}.`,
              "",
              "For each zone, assess:",
              "1. Zone configuration (nozzle type, soil type, slope, sun exposure)",
              "2. Recent watering history and frequency",
              "3. Any error events or fault alerts",
              "4. Valve monitoring data if available (solenoid mA readings, drift from baseline)",
              "",
              "Flag any zones that may need attention and provide recommendations.",
              "",
              "Use the get_device, get_events, and get_zone tools to gather this information.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
