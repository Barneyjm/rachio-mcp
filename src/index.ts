import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { RachioClient, type Env } from "./rachio-client.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

class RachioMcpAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "rachio",
    version: "1.0.0",
  });

  async init() {
    const client = new RachioClient(this.env);
    registerTools(this.server, client);
    registerResources(this.server, client);
    registerPrompts(this.server);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

function validateAuth(request: Request, env: Env): Response | null {
  const url = new URL(request.url);

  // Layer 1: URL secret validation
  const secret = url.searchParams.get("secret");
  if (!secret || !timingSafeEqual(secret, env.URL_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Layer 2: Cloudflare Access service token validation (if configured)
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    const clientId = request.headers.get("CF-Access-Client-Id");
    const clientSecret = request.headers.get("CF-Access-Client-Secret");
    if (
      !clientId ||
      !clientSecret ||
      !timingSafeEqual(clientId, env.CF_ACCESS_CLIENT_ID) ||
      !timingSafeEqual(clientSecret, env.CF_ACCESS_CLIENT_SECRET)
    ) {
      return new Response("Forbidden: invalid Cloudflare Access service token", { status: 403 });
    }
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check (no auth required)
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Authenticate
    const authError = validateAuth(request, env);
    if (authError) return authError;

    // MCP endpoint
    if (url.pathname === "/mcp") {
      return RachioMcpAgent.mount("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
