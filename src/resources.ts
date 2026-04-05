import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RachioClient } from "./rachio-client.js";

export function registerResources(server: McpServer, client: RachioClient) {
  server.resource(
    "device_status",
    new ResourceTemplate("rachio://device/{id}/status", { list: undefined }),
    {
      description: "Current device status and active zone",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const deviceId = Array.isArray(id) ? id[0] : id;
      const [device, state] = await Promise.all([
        client.getDevice(deviceId),
        client.getDeviceState(deviceId),
      ]);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ device, state }, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    "device_zones",
    new ResourceTemplate("rachio://device/{id}/zones", { list: undefined }),
    {
      description: "All zones with configuration",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const deviceId = Array.isArray(id) ? id[0] : id;
      const device = (await client.getDevice(deviceId)) as { zones?: unknown[] };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(device?.zones || [], null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    "device_schedules",
    new ResourceTemplate("rachio://device/{id}/schedules", { list: undefined }),
    {
      description: "All schedules with next run times",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const deviceId = Array.isArray(id) ? id[0] : id;
      const [device, currentSchedule] = await Promise.all([
        client.getDevice(deviceId) as Promise<{
          scheduleRules?: unknown[];
          flexScheduleRules?: unknown[];
        }>,
        client.getCurrentSchedule(deviceId),
      ]);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                scheduleRules: device?.scheduleRules || [],
                flexScheduleRules: device?.flexScheduleRules || [],
                currentSchedule,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.resource(
    "device_forecast",
    new ResourceTemplate("rachio://device/{id}/forecast", { list: undefined }),
    {
      description: "14-day weather forecast for device location",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const deviceId = Array.isArray(id) ? id[0] : id;
      const forecast = await client.getForecast(deviceId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(forecast, null, 2),
          },
        ],
      };
    }
  );
}
