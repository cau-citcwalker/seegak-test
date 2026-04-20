"""
Network-simulating reverse proxy for benchmark testing.

Sits between browser and benchmark-server, adding configurable
latency and bandwidth throttling to simulate real network conditions.
"""

import asyncio
import logging
import time

from aiohttp import web, ClientSession, WSMsgType

BACKEND_HTTP = "http://backend:5001"
BACKEND_WS = "ws://backend:5001"

log = logging.getLogger("proxy")

# ── Network simulation config ──────────────────────────────────────

config = {
    "profile": "4g",
    "latency_ms": 30,       # round-trip latency in ms
    "bandwidth_kbps": 10_000,  # 0 = unlimited
}

PROFILES = {
    "local":     {"latency_ms": 0,   "bandwidth_kbps": 0},
    "fast_wifi": {"latency_ms": 5,   "bandwidth_kbps": 30_000},
    "4g":        {"latency_ms": 30,  "bandwidth_kbps": 10_000},
    "3g":        {"latency_ms": 100, "bandwidth_kbps": 1_500},
    "slow_3g":   {"latency_ms": 300, "bandwidth_kbps": 400},
}


async def simulate_latency_half():
    """Simulate half the RTT (applied on request and response)."""
    delay = config["latency_ms"] / 2000
    if delay > 0:
        await asyncio.sleep(delay)


async def simulate_bandwidth(data_bytes: int):
    """Simulate bandwidth throttle based on data size."""
    bw = config["bandwidth_kbps"]
    if bw > 0 and data_bytes > 0:
        bytes_per_sec = bw * 1000 / 8
        delay = data_bytes / bytes_per_sec
        await asyncio.sleep(delay)


# ── Config endpoint ────────────────────────────────────────────────

async def handle_config(request: web.Request):
    if request.method == "GET":
        return web.json_response({
            **config,
            "profiles": {k: v for k, v in PROFILES.items()},
        }, headers=CORS_HEADERS)

    # POST — set profile or custom values
    data = await request.json()
    profile = data.get("profile")
    if profile and profile in PROFILES:
        config["profile"] = profile
        config["latency_ms"] = PROFILES[profile]["latency_ms"]
        config["bandwidth_kbps"] = PROFILES[profile]["bandwidth_kbps"]
    else:
        if "latency_ms" in data:
            config["latency_ms"] = max(0, int(data["latency_ms"]))
        if "bandwidth_kbps" in data:
            config["bandwidth_kbps"] = max(0, int(data["bandwidth_kbps"]))
        config["profile"] = "custom"

    log.info(f"Network config updated: {config}")
    return web.json_response(config, headers=CORS_HEADERS)


# ── CORS preflight ─────────────────────────────────────────────────

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "3600",
    "Access-Control-Expose-Headers": "content-length, grpc-status, grpc-message",
}


async def handle_options(request: web.Request):
    return web.Response(status=204, headers=CORS_HEADERS)


# ── HTTP reverse proxy ─────────────────────────────────────────────

async def proxy_http(request: web.Request):
    try:
        await simulate_latency_half()

        url = f"{BACKEND_HTTP}{request.path_qs}"
        fwd_headers = {
            k: v for k, v in request.headers.items()
            if k.lower() not in ("host", "transfer-encoding")
        }

        body = await request.read() if request.can_read_body else None

        # auto_decompress=False: pass through compressed responses as-is
        # (critical for Brotli benchmark — browser must decompress, not proxy)
        async with ClientSession(auto_decompress=False) as session:
            async with session.request(
                request.method, url,
                headers=fwd_headers,
                data=body,
            ) as resp:
                resp_body = await resp.read()

                # Simulate bandwidth for response payload
                await simulate_bandwidth(len(resp_body))
                await simulate_latency_half()

                # Forward response headers (skip hop-by-hop)
                headers = dict(CORS_HEADERS)
                for k, v in resp.headers.items():
                    kl = k.lower()
                    if kl not in ("transfer-encoding", "content-length"):
                        headers[k] = v

                return web.Response(
                    status=resp.status,
                    headers=headers,
                    body=resp_body,
                )
    except Exception as e:
        log.error(f"Proxy error for {request.method} {request.path_qs}: {e}")
        return web.Response(
            status=502,
            headers=CORS_HEADERS,
            text=f"Proxy error: {e}",
        )


# ── WebSocket reverse proxy ────────────────────────────────────────

async def proxy_ws(request: web.Request):
    ws_client = web.WebSocketResponse()
    await ws_client.prepare(request)

    url = f"{BACKEND_WS}{request.path_qs}"

    async with ClientSession() as session:
        async with session.ws_connect(url) as ws_server:
            async def server_to_client():
                async for msg in ws_server:
                    # Latency on incoming data
                    delay = config["latency_ms"] / 1000
                    if delay > 0:
                        await asyncio.sleep(delay)

                    if msg.type == WSMsgType.BINARY:
                        await simulate_bandwidth(len(msg.data))
                        await ws_client.send_bytes(msg.data)
                    elif msg.type == WSMsgType.TEXT:
                        await simulate_bandwidth(len(msg.data.encode()))
                        await ws_client.send_str(msg.data)
                    elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.ERROR):
                        break

            async def client_to_server():
                async for msg in ws_client:
                    if msg.type == WSMsgType.BINARY:
                        await ws_server.send_bytes(msg.data)
                    elif msg.type == WSMsgType.TEXT:
                        await ws_server.send_str(msg.data)
                    elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.ERROR):
                        break

            done, pending = await asyncio.wait(
                [asyncio.create_task(server_to_client()),
                 asyncio.create_task(client_to_server())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()

    return ws_client


# ── SSE reverse proxy ──────────────────────────────────────────────

async def proxy_sse(request: web.Request):
    """Stream SSE events with bandwidth/latency simulation."""
    await simulate_latency_half()

    url = f"{BACKEND_HTTP}{request.path_qs}"
    fwd_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "transfer-encoding")
    }

    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            **CORS_HEADERS,
        },
    )
    await resp.prepare(request)

    async with ClientSession() as session:
        async with session.get(url, headers=fwd_headers) as backend_resp:
            async for chunk in backend_resp.content.iter_any():
                await simulate_bandwidth(len(chunk))
                delay = config["latency_ms"] / 1000
                if delay > 0:
                    await asyncio.sleep(delay)
                await resp.write(chunk)

    await resp.write_eof()
    return resp


# ── App setup ───────────────────────────────────────────────────────

app = web.Application()

# Config API
app.router.add_route("GET",  "/proxy/config", handle_config)
app.router.add_route("POST", "/proxy/config", handle_config)

# CORS preflight
app.router.add_route("OPTIONS", "/{path:.*}", handle_options)

# WebSocket routes (must match before catch-all)
app.router.add_route("GET", "/ws/{path:.*}", proxy_ws)

# SSE route
app.router.add_route("GET", "/api/scatter.sse", proxy_sse)

# Catch-all HTTP proxy
app.router.add_route("*", "/{path:.*}", proxy_http)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    log.info("Network proxy starting on :5002")
    log.info(f"Default config: {config}")
    web.run_app(app, host="0.0.0.0", port=5002)
