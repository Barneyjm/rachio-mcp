import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { RachioClient, type Env } from "./rachio-client.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export { RateLimiter } from "./rate-limiter.js";

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "rachio", version: "1.0.0" });
  const client = new RachioClient(env);
  registerTools(server, client);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bufA = new Uint8Array(digestA);
  const bufB = new Uint8Array(digestB);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

async function validateAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  // Layer 1: URL secret validation
  const secret = url.searchParams.get("secret");
  if (!secret || !(await timingSafeEqual(secret, env.URL_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Layer 2: Cloudflare Access service token validation (if configured)
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    const clientId = request.headers.get("CF-Access-Client-Id");
    const clientSecret = request.headers.get("CF-Access-Client-Secret");
    if (
      !clientId ||
      !clientSecret ||
      !(await timingSafeEqual(clientId, env.CF_ACCESS_CLIENT_ID)) ||
      !(await timingSafeEqual(clientSecret, env.CF_ACCESS_CLIENT_SECRET))
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
    const authError = await validateAuth(request, env);
    if (authError) return authError;

    // MCP endpoint
    if (url.pathname === "/mcp") {
      const server = createServer(env);
      const transport = new WebStandardStreamableHTTPServerTransport({});
      await server.connect(transport);
      return transport.handleRequest(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
