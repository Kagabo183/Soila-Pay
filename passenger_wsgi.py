"""
Entry point for cPanel "Setup Python App" (Phusion Passenger), used on
shared hosting where uvicorn can't run as a service.

Passenger only speaks WSGI and never sends ASGI lifespan events, but the app
needs its startup (DB pool, LMBTech client, background status checker). So:
  - one asyncio event loop runs in a background thread for the life of the
    Passenger process;
  - the FastAPI lifespan is entered on that loop before the first request;
  - a2wsgi bridges each WSGI request onto the same loop.

cPanel can mount the app at a URL prefix (Application URL "api" -> /api/...):
Passenger then sends SCRIPT_NAME=/api and PATH_INFO=/v1/..., so the prefix
is put back on the path - the routes are /api/v1/... - before routing.

Status updates must not depend on this process staying alive (Passenger
stops idle apps), so a cron job also runs scripts/sync_pending.py.
"""
import asyncio
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from a2wsgi import ASGIMiddleware  # noqa: E402

from app.main import app as fastapi_app  # noqa: E402

_loop = asyncio.new_event_loop()
threading.Thread(target=_loop.run_forever, name="asgi-loop", daemon=True).start()


async def _startup():
    cm = fastapi_app.router.lifespan_context(fastapi_app)
    await cm.__aenter__()
    return cm


# Runs the app's startup once, before Passenger hands us any request.
_lifespan = asyncio.run_coroutine_threadsafe(_startup(), _loop).result(timeout=60)


from app.config import settings  # noqa: E402

# When the app is mounted at the site root (LiteSpeed on Namecheap only runs
# Python apps reliably at "/"), it may also be handed requests for the
# website itself. STATIC_SITE_DIR = the folder with the exported frontend;
# anything outside /api is served from there (index.html for folders,
# 404.html when missing).
_static = None
if settings.static_site_dir and os.path.isdir(settings.static_site_dir):
    from starlette.staticfiles import StaticFiles

    _static = StaticFiles(directory=settings.static_site_dir, html=True)


async def _with_mount_prefix(scope, receive, send):
    if scope["type"] in ("http", "websocket"):
        prefix = scope.get("root_path", "")
        if prefix and not scope["path"].startswith(prefix):
            scope = {**scope, "path": prefix + scope["path"], "raw_path": (prefix + scope["path"]).encode()}
        scope = {**scope, "root_path": ""}
        if _static is not None and scope["type"] == "http" and not scope["path"].startswith(("/api/", "/healthz")):
            await _static(scope, receive, send)
            return
    await fastapi_app(scope, receive, send)


application = ASGIMiddleware(_with_mount_prefix, loop=_loop)
