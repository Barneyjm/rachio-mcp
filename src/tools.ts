import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RachioClient } from "./rachio-client.js";

type ToolResult = { content: { type: "text"; text: string }[] };

function json(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function confirmationGuard(action: string, confirm: boolean | undefined): ToolResult | null {
  if (confirm) return null;
  return {
    content: [
      {
        type: "text",
        text: `⚠️ This will ${action}. Call again with confirm: true to proceed.`,
      },
    ],
  };
}

export function registerTools(server: McpServer, client: RachioClient) {
  // ── Read-Only Tools ──

  server.tool(
    "get_person",
    "Get authenticated user profile, including the devices array. Call this first to discover device IDs. Each device contains zone and schedule summaries. Use a device ID (not the person ID) with other tools.",
    {},
    async () => json(await client.getPerson())
  );

  server.tool(
    "get_device",
    "Get full device details including zones, schedules, and status. Requires a device ID from get_person (found in the devices array, NOT the top-level person id).",
    { device_id: z.string().describe("Rachio device ID (from get_person devices[].id)") },
    async ({ device_id }) => json(await client.getDevice(device_id))
  );

  server.tool(
    "get_device_state",
    "Get current operational state of the controller (watering status, active zone)",
    { device_id: z.string().describe("Rachio device ID") },
    async ({ device_id }) => json(await client.getDeviceState(device_id))
  );

  server.tool(
    "get_zone",
    "Get details for a specific zone (config, nozzle type, soil type, slope)",
    { zone_id: z.string().describe("Rachio zone ID") },
    async ({ zone_id }) => json(await client.getZone(zone_id))
  );

  server.tool(
    "get_current_schedule",
    "Get the currently running or next scheduled run for a device",
    { device_id: z.string().describe("Rachio device ID") },
    async ({ device_id }) => json(await client.getCurrentSchedule(device_id))
  );

  server.tool(
    "get_schedule_rule",
    "Get details for a specific schedule rule",
    { schedule_id: z.string().describe("Rachio schedule ID") },
    async ({ schedule_id }) => json(await client.getScheduleRule(schedule_id))
  );

  server.tool(
    "get_flex_schedule",
    "Get details for a Flex Daily schedule",
    { schedule_id: z.string().describe("Rachio flex schedule ID") },
    async ({ schedule_id }) => json(await client.getFlexSchedule(schedule_id))
  );

  server.tool(
    "get_forecast",
    "Get weather forecast for the device location (precipitation, ET, temperature)",
    { device_id: z.string().describe("Rachio device ID") },
    async ({ device_id }) => json(await client.getForecast(device_id))
  );

  server.tool(
    "get_events",
    "Get device event history within a time range",
    {
      device_id: z.string().describe("Rachio device ID"),
      start_time: z.number().describe("Start time in epoch milliseconds"),
      end_time: z.number().describe("End time in epoch milliseconds"),
    },
    async ({ device_id, start_time, end_time }) =>
      json(await client.getEvents(device_id, start_time, end_time))
  );

  server.tool(
    "get_webhooks",
    "List registered webhooks for a device",
    { device_id: z.string().describe("Rachio device ID") },
    async ({ device_id }) => json(await client.getWebhooks(device_id))
  );

  // ── Write Tools (confirmation required) ──

  server.tool(
    "start_zone",
    "Start watering a specific zone for a given duration",
    {
      zone_id: z.string().describe("Rachio zone ID"),
      duration_seconds: z
        .number()
        .int()
        .min(1)
        .max(10800)
        .describe("Duration in seconds (max 3 hours)"),
      confirm: z.boolean().describe("Must be true to execute. If false, returns preview."),
    },
    async ({ zone_id, duration_seconds, confirm }) => {
      const guard = confirmationGuard(
        `start zone ${zone_id} for ${duration_seconds} seconds`,
        confirm
      );
      if (guard) return guard;
      return json(await client.startZone(zone_id, duration_seconds));
    }
  );

  server.tool(
    "start_multiple_zones",
    "Start watering multiple zones in sequence",
    {
      zones: z
        .array(
          z.object({
            id: z.string().describe("Zone ID"),
            duration_seconds: z.number().int().min(1).max(10800).describe("Duration in seconds"),
            sort_order: z.number().int().describe("Order in sequence"),
          })
        )
        .describe("Array of zones to water"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ zones, confirm }) => {
      const guard = confirmationGuard(
        `start ${zones.length} zones in sequence`,
        confirm
      );
      if (guard) return guard;
      return json(
        await client.startMultipleZones(
          zones.map((z) => ({ id: z.id, duration: z.duration_seconds, sortOrder: z.sort_order }))
        )
      );
    }
  );

  server.tool(
    "stop_water",
    "Stop all watering on the device immediately",
    {
      device_id: z.string().describe("Rachio device ID"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ device_id, confirm }) => {
      const guard = confirmationGuard(`stop all watering on device ${device_id}`, confirm);
      if (guard) return guard;
      return json(await client.stopWater(device_id));
    }
  );

  server.tool(
    "rain_delay",
    "Set or cancel a rain delay. To set: provide a future ISO 8601 expiration timestamp. To cancel: provide a past timestamp or the current time.",
    {
      device_id: z.string().describe("Rachio device ID"),
      rain_delay_expiration: z.string().describe("ISO 8601 timestamp for when the delay expires (e.g. '2026-04-09T12:00:00.000Z'). Use a past time to cancel."),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ device_id, rain_delay_expiration, confirm }) => {
      const expDate = new Date(rain_delay_expiration);
      const isCanceling = expDate <= new Date();
      const guard = confirmationGuard(
        isCanceling
          ? `cancel rain delay on device ${device_id}`
          : `set rain delay on device ${device_id} until ${rain_delay_expiration}`,
        confirm
      );
      if (guard) return guard;
      return json(await client.rainDelay(device_id, rain_delay_expiration));
    }
  );

  server.tool(
    "set_moisture_percent",
    "Manually override estimated moisture level for a zone (for soil sensor integration)",
    {
      zone_id: z.string().describe("Rachio zone ID"),
      percent: z.number().min(0).max(1).describe("Moisture level from 0.0 (dry) to 1.0 (saturated)"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ zone_id, percent, confirm }) => {
      const guard = confirmationGuard(
        `set moisture to ${(percent * 100).toFixed(0)}% on zone ${zone_id}`,
        confirm
      );
      if (guard) return guard;
      return json(await client.setMoisturePercent(zone_id, percent));
    }
  );

  server.tool(
    "skip_schedule",
    "Skip the next run of a schedule",
    {
      schedule_id: z.string().describe("Rachio schedule ID"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ schedule_id, confirm }) => {
      const guard = confirmationGuard(`skip the next run of schedule ${schedule_id}`, confirm);
      if (guard) return guard;
      return json(await client.skipSchedule(schedule_id));
    }
  );

  server.tool(
    "start_schedule",
    "Manually start a schedule",
    {
      schedule_id: z.string().describe("Rachio schedule ID"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ schedule_id, confirm }) => {
      const guard = confirmationGuard(`start schedule ${schedule_id}`, confirm);
      if (guard) return guard;
      return json(await client.startSchedule(schedule_id));
    }
  );

  server.tool(
    "seasonal_adjustment",
    "Adjust the seasonal watering percentage for a schedule (e.g. 0.8 = 80% of normal runtime)",
    {
      schedule_id: z.string().describe("Rachio schedule ID"),
      adjustment: z.number().min(0).max(2).describe("Seasonal adjustment multiplier (0.0-2.0, where 1.0 = 100% normal)"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ schedule_id, adjustment, confirm }) => {
      const guard = confirmationGuard(
        `set seasonal adjustment to ${(adjustment * 100).toFixed(0)}% on schedule ${schedule_id}`,
        confirm
      );
      if (guard) return guard;
      return json(await client.seasonalAdjustment(schedule_id, adjustment));
    }
  );

  server.tool(
    "skip_forward_zone_run",
    "Skip the currently running zone and advance to the next zone in the schedule",
    {
      schedule_id: z.string().describe("Rachio schedule ID"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ schedule_id, confirm }) => {
      const guard = confirmationGuard(`skip forward to next zone in schedule ${schedule_id}`, confirm);
      if (guard) return guard;
      return json(await client.skipForwardZoneRun(schedule_id));
    }
  );

  // ── Location/Weather Thresholds (cloud-rest API) ──

  server.tool(
    "update_location_threshold",
    "Update a weather threshold for skip conditions (wind speed, freeze temp, rain amount). Requires a location_id which can be found via get_device.",
    {
      location_id: z.string().describe("Location ID (from device data)"),
      name: z.enum([
        "IRRIGATION_CONTROLLER_WIND",
        "IRRIGATION_CONTROLLER_TEMPERATURE",
        "IRRIGATION_CONTROLLER_PRECIPITATION",
      ]).describe("Threshold type: WIND (mph), TEMPERATURE (°F freeze threshold), PRECIPITATION (inches)"),
      value: z.number().describe("Threshold value (e.g. 10 for 10 mph wind, 32 for 32°F freeze, 0.1 for 0.1\" rain)"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ location_id, name, value, confirm }) => {
      const guard = confirmationGuard(`set ${name} threshold to ${value} for location ${location_id}`, confirm);
      if (guard) return guard;
      return json(await client.updateLocationThreshold(location_id, name, value));
    }
  );

  // ── Device Control (cloud-rest API) ──

  server.tool(
    "set_device_standby",
    "Put the device into standby mode (all watering paused) or take it out of standby",
    {
      device_id: z.string().describe("Rachio device ID"),
      standby: z.boolean().describe("true = standby (off), false = active (on)"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ device_id, standby, confirm }) => {
      const guard = confirmationGuard(
        `set device ${device_id} to ${standby ? "standby (off)" : "active (on)"}`,
        confirm
      );
      if (guard) return guard;
      return json(await client.setDeviceStandby(device_id, standby));
    }
  );

  // ── Watering History (cloud-rest API) ──

  server.tool(
    "get_watering_summary",
    "Get watering history summary for a specific zone over a date range. Returns total runtime, water usage, and event breakdown.",
    {
      device_id: z.string().describe("Rachio device ID"),
      zone_id: z.string().describe("Rachio zone ID"),
      start_date: z.object({
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
      }).describe("Start date"),
      end_date: z.object({
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
      }).describe("End date"),
    },
    async ({ device_id, zone_id, start_date, end_date }) =>
      json(await client.getWateringSummary(device_id, zone_id, start_date, end_date))
  );

  // ── Schedule Creation (cloud-rest API) ──

  const scheduleCriteriaSchema = z.object({
    schedule_type: z.enum(["FLEX_DAILY", "FIXED", "INTERVAL"]).describe("Schedule type"),
    rain_delay_enabled: z.boolean().default(false),
    freeze_delay_enabled: z.boolean().default(true),
    wind_delay_enabled: z.boolean().default(true),
    climate_skip: z.boolean().default(false),
    seasonal_shift: z.boolean().default(false),
    start_date: z.object({
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
    }).describe("Schedule start date"),
    start_sun_time: z.enum(["SUNRISE", "SUNSET"]).optional().describe("Start relative to sun (use this OR start_time)"),
    start_time: z.number().int().optional().describe("Start time in minutes from midnight (use this OR start_sun_time)"),
    cycle_soak: z.boolean().default(false),
    smart_cycle: z.boolean().default(true),
    zone_delay_time: z.number().int().default(0).describe("Delay between zones in seconds"),
  });

  const zoneInfoSchema = z.object({
    device_id: z.string().describe("Rachio device ID"),
    zone_id: z.string().describe("Rachio zone ID"),
    order_id: z.number().int().describe("Zone order in sequence (0-based)"),
    watering_time: z.number().int().min(0).describe("Watering duration in seconds (0 for flex auto-calculation)"),
    flex_aggression_coefficient: z.number().default(1).describe("Flex aggression multiplier (1.0 = normal)"),
    flex_runtime_coefficient: z.number().default(1).describe("Flex runtime multiplier (1.0 = normal)"),
  });

  server.tool(
    "preview_schedule",
    "Preview what a schedule would look like before creating it. Returns projected run times and water usage. Uses the cloud-rest API.",
    {
      name: z.string().describe("Schedule name"),
      schedule_criteria: scheduleCriteriaSchema,
      zone_info: z.array(zoneInfoSchema).describe("Zones to include in the schedule"),
      schedule_restriction_criteria: z.record(z.unknown()).default({}).describe("Optional watering restrictions"),
    },
    async ({ name, schedule_criteria, zone_info, schedule_restriction_criteria }) => {
      return json(await client.previewSchedule({
        name,
        schedule_criteria,
        zone_info,
        schedule_restriction_criteria,
      }));
    }
  );

  server.tool(
    "create_schedule",
    "Create a new watering schedule. Use preview_schedule first to verify settings. Uses the cloud-rest API (undocumented, reverse-engineered from app).",
    {
      name: z.string().describe("Schedule name"),
      enabled: z.boolean().describe("Whether the schedule is active"),
      schedule_criteria: scheduleCriteriaSchema,
      zone_info: z.array(zoneInfoSchema).describe("Zones to include in the schedule"),
      schedule_restriction_criteria: z.record(z.unknown()).default({}).describe("Optional watering restrictions"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ name, enabled, schedule_criteria, zone_info, schedule_restriction_criteria, confirm }) => {
      const guard = confirmationGuard(`create schedule "${name}" with ${zone_info.length} zones`, confirm);
      if (guard) return guard;
      return json(await client.createSchedule({
        name,
        enabled,
        schedule_criteria,
        zone_info,
        schedule_restriction_criteria,
      }));
    }
  );

  server.tool(
    "update_schedule",
    "Update an existing schedule. Can modify name, zones, criteria, and enabled state. Uses the cloud-rest API.",
    {
      schedule_id: z.string().describe("ID of the schedule to update"),
      name: z.string().describe("Schedule name"),
      enabled: z.boolean().describe("Whether the schedule is active"),
      schedule_criteria: scheduleCriteriaSchema,
      zone_info: z.array(zoneInfoSchema).describe("Zones to add or update in the schedule"),
      zone_ids_to_remove: z.array(z.string()).default([]).describe("Zone IDs to remove from the schedule"),
      schedule_restriction_criteria: z.record(z.unknown()).default({}).describe("Optional watering restrictions"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ schedule_id, name, enabled, schedule_criteria, zone_info, zone_ids_to_remove, schedule_restriction_criteria, confirm }) => {
      const guard = confirmationGuard(`update schedule "${name}" (${schedule_id})`, confirm);
      if (guard) return guard;
      return json(await client.updateSchedule(schedule_id, {
        name,
        enabled,
        schedule_criteria,
        zone_info,
        schedule_restriction_criteria,
      }, zone_ids_to_remove));
    }
  );

  server.tool(
    "delete_schedule",
    "Delete a schedule permanently. Uses the cloud-rest API.",
    {
      schedule_id: z.string().describe("ID of the schedule to delete"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ schedule_id, confirm }) => {
      const guard = confirmationGuard(`permanently delete schedule ${schedule_id}`, confirm);
      if (guard) return guard;
      return json(await client.deleteSchedule(schedule_id));
    }
  );

  // ── Webhook Management ──

  server.tool(
    "create_webhook",
    "Register a new webhook for device events",
    {
      device_id: z.string().describe("Rachio device ID"),
      url: z.string().url().describe("Webhook callback URL"),
      event_types: z.array(z.string()).describe("Array of event type IDs to subscribe to"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ device_id, url, event_types, confirm }) => {
      const guard = confirmationGuard(
        `create a webhook to ${url} for ${event_types.length} event types`,
        confirm
      );
      if (guard) return guard;
      return json(await client.createWebhook(device_id, url, event_types));
    }
  );

  server.tool(
    "delete_webhook",
    "Remove a registered webhook",
    {
      webhook_id: z.string().describe("Webhook ID to delete"),
      confirm: z.boolean().describe("Must be true to execute"),
    },
    async ({ webhook_id, confirm }) => {
      const guard = confirmationGuard(`delete webhook ${webhook_id}`, confirm);
      if (guard) return guard;
      return json(await client.deleteWebhook(webhook_id));
    }
  );
}
