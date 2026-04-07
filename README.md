# Rachio MCP Server

A Cloudflare Worker that exposes the [Rachio](https://rachio.com) irrigation API as an MCP (Model Context Protocol) server, enabling Claude to monitor and control your sprinkler system.

## Features

- **20 MCP tools** — read-only queries and confirmed write actions for zones, schedules, weather, and more
- **4 MCP resources** — device status, zones, schedules, and forecast as context-loadable resources
- **2 MCP prompts** — irrigation status summary and zone health check templates
- **Defense-in-depth auth** — URL secret (Layer 1) + Cloudflare Access service token (Layer 2)
- **Rate limiting** — tracks daily Rachio API budget via KV to stay under the 1,700/day cap
- **Safety controls** — write tools require explicit `confirm: true`; zone durations capped at 3 hours

## Setup

### Prerequisites

- A Rachio API key from [rachio.com/api](https://rachio.com/api)
- A Cloudflare account with Workers enabled

### 1. Add GitHub repository secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `RACHIO_API_KEY` | Rachio API bearer token |
| `RACHIO_MCP_URL_SECRET` | 64-char hex string (`openssl rand -hex 32`) |
| `CF_ACCESS_CLIENT_ID` | _(optional)_ Cloudflare Access service token client ID |
| `CF_ACCESS_CLIENT_SECRET` | _(optional)_ Cloudflare Access service token client secret |

### 2. Run the Setup workflow

Go to **Actions > Setup Infrastructure > Run workflow**. This will:
- Create the `RATE_LIMIT` KV namespace
- Push all secrets to the Cloudflare Worker

After it runs, copy the KV namespace ID from the workflow logs into `wrangler.toml` and uncomment the `[[kv_namespaces]]` block.

### 3. Deploy

Push to `main` — the **Deploy** workflow runs automatically (typecheck + `wrangler deploy`).

Or run manually:

```bash
npm install
npm run deploy
```

### 5. Connect to Claude

Add as an MCP connector in Claude.ai:

```
https://rachio-mcp.<your-subdomain>.workers.dev/mcp?secret=<your-url-secret>
```

If using Cloudflare Access (Layer 2), configure your MCP client to send `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

## Tools

### Read-Only

| Tool | Description |
|------|-------------|
| `get_person` | User profile and device IDs |
| `get_device` | Full device details with zones and schedules |
| `get_device_state` | Current watering status |
| `get_zone` | Zone configuration details |
| `get_current_schedule` | Running or next scheduled run |
| `get_schedule_rule` | Schedule rule details |
| `get_flex_schedule` | Flex Daily schedule details |
| `get_forecast` | Weather forecast for device location |
| `get_events` | Event history within a time range |
| `get_webhooks` | Registered webhooks |

### Write (confirmation required)

| Tool | Description |
|------|-------------|
| `start_zone` | Start watering a zone (max 3hr) |
| `start_multiple_zones` | Start multiple zones in sequence |
| `stop_water` | Stop all watering immediately |
| `rain_delay` | Pause watering for 1-7 days |
| `set_moisture_percent` | Override zone moisture level |
| `skip_schedule` | Skip next schedule run |
| `start_schedule` | Manually start a schedule |
| `create_webhook` | Register a webhook |
| `delete_webhook` | Remove a webhook |

## Development

```bash
npm run dev        # local dev server
npm run typecheck  # type checking
```
