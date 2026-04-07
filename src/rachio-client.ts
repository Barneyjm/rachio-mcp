export interface Env {
  RACHIO_API_KEY: string;
  RACHIO_API_BASE: string;
  RACHIO_CLOUD_BASE: string;
  MAX_DAILY_CALLS: string;
  MAX_ZONE_DURATION: string;
  URL_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  RATE_LIMIT?: KVNamespace;
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

  private todayKey(): string {
    const d = new Date();
    return `rate:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  async getRateLimitInfo(): Promise<RateLimitInfo> {
    const limit = this.maxDailyCalls;
    if (!this.env.RATE_LIMIT) {
      return { count: 0, limit, remaining: limit, resetAt: "unknown (KV not configured)" };
    }
    const key = this.todayKey();
    const val = await this.env.RATE_LIMIT.get(key);
    const count = val ? parseInt(val, 10) : 0;
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return { count, limit, remaining: limit - count, resetAt: tomorrow.toISOString() };
  }

  private async incrementRateLimit(): Promise<void> {
    if (!this.env.RATE_LIMIT) return;
    const key = this.todayKey();
    const val = await this.env.RATE_LIMIT.get(key);
    const count = val ? parseInt(val, 10) : 0;
    await this.env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 172800 });
  }

  private async checkRateLimit(): Promise<void> {
    const info = await this.getRateLimitInfo();
    if (info.remaining <= 0) {
      throw new Error(`Daily API rate limit reached (${info.limit} calls). Resets at ${info.resetAt}`);
    }
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown; base?: "public" | "cloud" } = {}
  ): Promise<unknown> {
    await this.checkRateLimit();

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
    await this.incrementRateLimit();

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
    return this.request("/public/person/info");
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

  async rainDelay(deviceId: string, durationDays: number): Promise<unknown> {
    const days = Math.min(Math.max(durationDays, 1), 7);
    return this.request("/public/device/rain_delay", {
      method: "PUT",
      body: { id: deviceId, duration: days * 86400 },
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
