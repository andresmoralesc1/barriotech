# UptimeRobot Configuration

BarrioTech uses [UptimeRobot](https://uptimerobot.com) (free tier: 50 monitors, 5-min checks) for external uptime monitoring. Caddy + PM2 are inside this VPS, so without an external check you wouldn't notice if both go down (e.g. OOM kill of PM2 daemon).

## Monitor 1 — Primary ping (Node process alive)

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) |
| Friendly Name | `barriotech.com.co — node` |
| URL | `https://barriotech.com.co/api/uptime` |
| Monitoring Interval | 5 minutes (free tier minimum) |
| Monitor Timeout | 30 seconds |
| Keyword (optional) | `ok` — ensures we don't false-positive on a 502/503 error page |
| Alert Contacts | Email (your address), Telegram bot (optional) |

This endpoint (`apps/web/app/api/uptime/route.ts`) runs **zero work** — no DB, no auth, just `200 OK` + body `"ok"`. Hits the Node process 288 times/day without driving any load.

If it ever returns non-200, the **Node process itself is dead** (PM2 daemon killed it, OOM, deploy crashed, etc.).

## Monitor 2 — Full health (includes DB)

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) |
| Friendly Name | `barriotech.com.co — db` |
| URL | `https://barriotech.com.co/api/health/ready` |
| Monitoring Interval | 5 minutes |
| Monitor Timeout | 30 seconds |
| Keyword | `ok` — fires alert if DB check goes red |
| Alert Contacts | same as above |

`/api/health/ready` runs `SELECT 1` against Postgres. Fires alert if Postgres is down or the connection pool is exhausted.

**Why two monitors?** A 502 from `/api/uptime` means the Node process crashed; a 502 from `/api/health/ready` (while `/api/uptime` is still 200) means Postgres is broken but Node is fine. Different pages of your runbook.

## How to set up

1. Sign up at https://uptimerobot.com (free).
2. Click **+ Add New Monitor**.
3. Fill the fields for Monitor 1 above.
4. Repeat for Monitor 2.
5. Under **Alert Contacts**, add your email. (And a Telegram bot via the integrations page if you want push.)
6. Save.

## Expected response from `/api/uptime`

```
HTTP/1.1 200 OK
content-type: text/plain
cache-control: no-store, no-cache, must-revalidate

ok
```

## Expected response from `/api/health/ready`

```json
{ "status": "ok", "timestamp": "...", "checks": { "database": { "status": "ok", "latencyMs": 4 } } }
```

If the body changes (e.g. DB error) or the request times out, UptimeRobot fires an alert.

## Status page (optional, free)

UptimeRobot Public Status Pages (free, 1 page) at `status.andresmorales.com.co` if/when DNS is wired.

## Fallback / TODO

- Add a third monitor at `https://barriotech.com.co/api/health` (the legacy alias) once both monitors are running, to make sure the legacy endpoint is not relied on by anything.
- Once both monitors are in place, set yourself up for a couple of weeks to confirm "no false positives" before tuning the interval down (3-minute interval is a paid tier; 1-minute is much higher tier).
