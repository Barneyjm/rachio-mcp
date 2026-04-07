import type { RateLimiter } from "./rate-limiter.js";

export interface Env {
  RACHIO_API_KEY: string;
  RACHIO_API_BASE: string;
  RACHIO_CLOUD_BASE: string;
  MAX_DAILY_CALLS: string;
  MAX_ZONE_DURATION: string;
  URL_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  RATE_LIMITER?: DurableObjectNamespace<RateLimiter>;
}

export interface ScheduleZoneInfo {
  device_id: string;
  zone_id: string;
  order_id: number;
  watering_time: number;
  flex_aggression_coefficient: number;
  flex_runtime_coefficient: number;
}

export interface ScheduleCriteria {
  schedule_type: "FLEX_DAILY" | "FIXED" | "INTERVAL";
  rain_delay_enabled: boolean;
  freeze_delay_enabled: boolean;
  wind_delay_enabled: boolean;
  climate_skip: boolean;
  seasonal_shift: boolean;
  start_date: { year: number; month: number; day: number };
  start_sun_time?: "SUNRISE" | "SUNSET";
  start_time?: number;
  cycle_soak: boolean;
  smart_cycle: boolean;
  zone_delay_time: number;
}

export interface SchedulePayload {
  schedule_criteria: ScheduleCriteria;
  name: string;
  zone_info: ScheduleZoneInfo[];
  schedule_restriction_criteria: Record<string, unknown>;
}

interface RateLimitInfo {
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export class RachioClient {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private get maxDailyCalls(): number {
    return parseInt(this.env.MAX_DAILY_CALLS, 10) || 1500;
  }

  private get maxZoneDuration(): number {
    return parseInt(this.env.MAX_ZONE_DURATION, 10) || 10800;
  }

  private getRateLimiterStub(): DurableObjectStub<RateLimiter> | null {
    if (!this.env.RATE_LIMITER) return null;
    const id = this.env.RATE_LIMITER.idFromName("global");
    return this.env.RATE_LIMITER.get(id);
  }

  async getRateLimitInfo(): Promise<RateLimitInfo> {
    const limit = this.maxDailyCalls;
    const stub = this.getRateLimiterStub();
    if (!stub) {
      return { count: 0, limit, remaining: limit, resetAt: "unknown (Durable Object not configured)" };
    }
    const info = await stub.getInfo(limit);
    return { ...info, limit };
  }

  private async consumeRateLimit(): Promise<void> {
    const stub = this.getRateLimiterStub();
    if (!stub) return;
    const result = await stub.increment(this.maxDailyCalls);
    if (!result.allowed) {
      const info = await stub.getInfo(this.maxDailyCalls);
      throw new Error(`Daily API rate limit reached (${this.maxDailyCalls} calls). Resets at ${info.resetAt}`);
    }
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown; base?: "public" | "cloud" } = {}
  ): Promise<unknown> {
    await this.consumeRateLimit();

    const base = options.base === "cloud" ? this.env.RACHIO_CLOUD_BASE : this.env.RACHIO_API_BASE;
    const url = `${base}${path}`;
    const init: RequestInit = {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.env.RACHIO_API_KEY}`,
        "Content-Type": "application/json",
      },
    };
    if (options.body) {
      init.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text();
      const status = res.status;
      if (status === 401) throw new Error("Rachio API authentication failed. Check your API key.");
      if (status === 404) throw new Error(`Resource not found: ${path}`);
      if (status === 429) {
        const info = await this.getRateLimitInfo();
        throw new Error(`Rachio rate limited. Local budget: ${info.remaining}/${info.limit} remaining.`);
      }
      throw new Error(`Rachio API error ${status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  // ── Read-Only ──

  async getPerson(): Promise<unknown> {
    const info = (await this.request("/public/person/info")) as { id: string };
    return this.request(`/public/person/${info.id}`);
  }

  async getDevice(deviceId: string): Promise<unknown> {
    return this.request(`/public/device/${deviceId}`);
  }

  async getDeviceState(deviceId: string): Promise<unknown> {
    return this.request(`/device/getDeviceState/${deviceId}`, { base: "cloud" });
  }

  async getZone(zoneId: string): Promise<unknown> {
    return this.request(`/public/zone/${zoneId}`);
  }

  async getCurrentSchedule(deviceId: string): Promise<unknown> {
    return this.request(`/public/device/${deviceId}/current_schedule`);
  }

  async getScheduleRule(scheduleId: string): Promise<unknown> {
    return this.request(`/public/schedulerule/${scheduleId}`);
  }

  async getFlexSchedule(scheduleId: string): Promise<unknown> {
    return this.request(`/public/flexschedulerule/${scheduleId}`);
  }

  async getForecast(deviceId: string): Promise<unknown> {
    return this.request(`/public/device/${deviceId}/forecast?units=US`);
  }

  async getEvents(deviceId: string, startTime: number, endTime: number): Promise<unknown> {
    return this.request(`/public/device/${deviceId}/event?startTime=${startTime}&endTime=${endTime}`);
  }

  async getWebhooks(deviceId: string): Promise<unknown> {
    return this.request(`/public/notification/${deviceId}/webhook`);
  }

  // ── Write ──

  async startZone(zoneId: string, durationSeconds: number): Promise<unknown> {
    const duration = Math.min(durationSeconds, this.maxZoneDuration);
    return this.request("/public/zone/start", {
      method: "PUT",
      body: { id: zoneId, duration },
    });
  }

  async startMultipleZones(zones: { id: string; duration: number; sortOrder: number }[]): Promise<unknown> {
    const capped = zones.map((z) => ({
      id: z.id,
      duration: Math.min(z.duration, this.maxZoneDuration),
      sortOrder: z.sortOrder,
    }));
    return this.request("/public/zone/start_multiple", {
      method: "PUT",
      body: { zones: capped },
    });
  }

  async stopWater(deviceId: string): Promise<unknown> {
    return this.request("/public/device/stop_water", {
      method: "PUT",
      body: { id: deviceId },
    });
  }

  async rainDelay(deviceId: string, expiration: string): Promise<unknown> {
    return this.request("/device/setRainDelay", {
      method: "POST",
      body: { device_id: deviceId, rain_delay_expiration: expiration },
      base: "cloud",
    });
  }

  async setMoisturePercent(zoneId: string, percent: number): Promise<unknown> {
    return this.request("/public/zone/setMoisturePercent", {
      method: "PUT",
      body: { id: zoneId, percent: Math.round(percent * 100) },
    });
  }

  async skipSchedule(scheduleId: string): Promise<unknown> {
    return this.request("/public/schedulerule/skip", {
      method: "PUT",
      body: { id: scheduleId },
    });
  }

  async startSchedule(scheduleId: string): Promise<unknown> {
    return this.request("/public/schedulerule/start", {
      method: "PUT",
      body: { id: scheduleId },
    });
  }

  async seasonalAdjustment(scheduleId: string, adjustment: number): Promise<unknown> {
    return this.request("/public/schedulerule/seasonal_adjustment", {
      method: "PUT",
      body: { id: scheduleId, adjustment },
    });
  }

  async skipForwardZoneRun(scheduleId: string): Promise<unknown> {
    return this.request("/public/schedulerule/skip_forward_zone_run", {
      method: "PUT",
      body: { id: scheduleId },
    });
  }

  // ── Schedule Management (cloud-rest API) ──

  async previewSchedule(payload: SchedulePayload): Promise<unknown> {
    return this.request("/schedule/previewSchedule", {
      method: "POST",
      body: payload,
      base: "cloud",
    });
  }

  async createSchedule(payload: SchedulePayload & { enabled: boolean }): Promise<unknown> {
    return this.request("/schedule/createSchedule", {
      method: "POST",
      body: payload,
      base: "cloud",
    });
  }

  async updateSchedule(
    scheduleId: string,
    payload: SchedulePayload & { enabled: boolean },
    zonesToRemove?: string[]
  ): Promise<unknown> {
    return this.request("/schedule/updateSchedule", {
      method: "PUT",
      body: {
        schedule_id: scheduleId,
        schedule_criteria: payload.schedule_criteria,
        name: payload.name,
        enabled: payload.enabled,
        zone_info_to_add_or_update: payload.zone_info,
        zone_ids_to_remove: zonesToRemove || [],
        schedule_restriction_criteria: payload.schedule_restriction_criteria,
      },
      base: "cloud",
    });
  }

  async updateLocationThreshold(
    locationId: string,
    name: string,
    value: number
  ): Promise<unknown> {
    return this.request("/location/updateLocationThreshold", {
      method: "POST",
      body: {
        location_id: locationId,
        location_threshold: { name, value },
      },
      base: "cloud",
    });
  }

  async updateZone(zoneId: string, settings: {
    name?: string;
    enabled?: boolean;
    soil_type?: string;
    crop_type?: string;
    nozzle_type?: string;
    exposure_type?: string;
    slope_type?: string;
  }): Promise<unknown> {
    const body: Record<string, unknown> = { zone_id: zoneId };
    if (settings.name !== undefined) body.name = settings.name;
    if (settings.enabled !== undefined) body.enabled = settings.enabled;
    if (settings.soil_type !== undefined) body.soil_type = { value: settings.soil_type };
    if (settings.crop_type !== undefined) body.crop_type = { value: settings.crop_type };
    if (settings.nozzle_type !== undefined) body.nozzle_type = { value: settings.nozzle_type };
    if (settings.exposure_type !== undefined) body.exposure_type = { value: settings.exposure_type };
    if (settings.slope_type !== undefined) body.slope_type = { value: settings.slope_type };
    return this.request("/zone/updateBasicZone", {
      method: "PUT",
      body,
      base: "cloud",
    });
  }

  async setDeviceStandby(deviceId: string, standby: boolean): Promise<unknown> {
    return this.request("/device/updateIrrigationController", {
      method: "PUT",
      body: { id: deviceId, standby },
      base: "cloud",
    });
  }

  async getWateringSummary(
    deviceId: string,
    zoneId: string,
    startDate: { year: number; month: number; day: number },
    endDate: { year: number; month: number; day: number }
  ): Promise<unknown> {
    return this.request("/events/getWateringSummaryForZone", {
      method: "PUT",
      body: {
        device_id: deviceId,
        zone_id: zoneId,
        start_date: startDate,
        end_date: endDate,
      },
      base: "cloud",
    });
  }

  async getWateringSummaryByInterval(
    deviceId: string,
    startDate: { year: number; month: number; day: number },
    endDate: { year: number; month: number; day: number }
  ): Promise<unknown> {
    return this.request("/events/getWateringSummaryByInterval", {
      method: "PUT",
      body: {
        device_id: deviceId,
        start_date: startDate,
        end_date: endDate,
      },
      base: "cloud",
    });
  }

  async deleteSchedule(scheduleId: string): Promise<unknown> {
    return this.request(`/schedule/deleteSchedule/${scheduleId}`, {
      method: "DELETE",
      base: "cloud",
    });
  }

  // ── Webhooks ──

  async createWebhook(deviceId: string, url: string, eventTypes: string[]): Promise<unknown> {
    return this.request("/public/notification/webhook", {
      method: "POST",
      body: {
        device: { id: deviceId },
        externalId: `mcp-${Date.now()}`,
        url,
        eventTypes: eventTypes.map((t) => ({ id: t })),
      },
    });
  }

  async deleteWebhook(webhookId: string): Promise<unknown> {
    return this.request(`/public/notification/webhook/${webhookId}`, {
      method: "DELETE",
    });
  }
}
