import { DurableObject } from "cloudflare:workers";

export class RateLimiter extends DurableObject {
  private count: number | null = null;
  private dateKey: string | null = null;

  private todayKey(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  private async loadCount(): Promise<number> {
    const today = this.todayKey();
    if (this.dateKey === today && this.count !== null) {
      return this.count;
    }
    // New day or first load — reset
    if (this.dateKey !== today) {
      await this.ctx.storage.delete("count");
      await this.ctx.storage.put("dateKey", today);
      this.dateKey = today;
      this.count = 0;
      return 0;
    }
    this.count = (await this.ctx.storage.get<number>("count")) ?? 0;
    this.dateKey = (await this.ctx.storage.get<string>("dateKey")) ?? today;
    return this.count;
  }

  async increment(limit: number): Promise<{ count: number; remaining: number; allowed: boolean }> {
    const count = await this.loadCount();
    if (count >= limit) {
      return { count, remaining: 0, allowed: false };
    }
    this.count = count + 1;
    await this.ctx.storage.put("count", this.count);
    return { count: this.count, remaining: limit - this.count, allowed: true };
  }

  async getInfo(limit: number): Promise<{ count: number; remaining: number; resetAt: string }> {
    const count = await this.loadCount();
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return { count, remaining: limit - count, resetAt: tomorrow.toISOString() };
  }
}
