"""
Entry point for cPanel "Setup Python App" (LiteSpeed lswsgi / Passenger),
used on shared hosting where uvicorn can't run as a service.

The server only speaks WSGI and never sends ASGI lifespan events, but the
app needs its startup (DB pool, LMBTech client, background status checker).
So each worker process gets:
  - its own asyncio event loop, running in a background thread;
  - the FastAPI lifespan entered on that loop;
  - a2wsgi bridging every WSGI request onto that loop.
This is set up lazily, on the first request in each process: LiteSpeed
loads this file once and then FORKS workers, and threads don't survive a
fork - a loop started at import time would leave every worker hanging.

cPanel can mount the app at a URL prefix (Application URL "api" -> /api/...):
the server then sends SCRIPT_NAME=/api and PATH_INFO=/v1/..., so the prefix
is put back on the path - the routes are /api/v1/... - before routing.
Mounted at the site root instead (LiteSpeed on Namecheap only runs Python
apps reliably at "/"), it also serves the exported frontend from
STATIC_SITE_DIR for every path outside /api.

Status updates must not depend on a worker staying alive (idle apps are
stopped), so a cron job also runs scripts/sync_pending.py.
"""
import asyncio
import os
import sys
import threading

# lswsgi closes stdout: log lines written there fail with "Broken pipe".
# Send them to stderr, which the server keeps in <app root>/stderr.log.
sys.stdout = sys.stderr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from a2wsgi import ASGIMiddleware  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402

_static = None
if settings.static_site_dir and os.path.isdir(settings.static_site_dir):
    from starlette.staticfiles import StaticFiles

    _static = StaticFiles(directory=settings.static_site_dir, html=True)


async def _asgi(scope, receive, send):
    if scope["type"] in ("http", "websocket"):
        prefix = scope.get("root_path", "")
        if prefix and not scope["path"].startswith(prefix):
            scope = {**scope, "path": prefix + scope["path"], "raw_path": (prefix + scope["path"]).encode()}
        scope = {**scope, "root_path": ""}
        if _static is not None and scope["type"] == "http" and not scope["path"].startswith(("/api/", "/healthz")):
            await _static(scope, receive, send)
            return
    await fastapi_app(scope, receive, send)


# "lifespan" must stay referenced for the life of the process: if the entered
# lifespan context is garbage-collected, its cleanup runs and closes the DB pool.
_state = {"pid": None, "wsgi": None, "lifespan": None}
_init_lock = threading.Lock()


def _worker_app():
    """The WSGI app for THIS process - built on its first request."""
    if _state["pid"] != os.getpid():
        with _init_lock:
            if _state["pid"] != os.getpid():
                loop = asyncio.new_event_loop()
                threading.Thread(target=loop.run_forever, name="asgi-loop", daemon=True).start()

                async def startup():
                    cm = fastapi_app.router.lifespan_context(fastapi_app)
                    await cm.__aenter__()
                    return cm

                _state["lifespan"] = asyncio.run_coroutine_threadsafe(startup(), loop).result(timeout=60)
                _state["wsgi"] = ASGIMiddleware(_asgi, loop=loop)
                _state["pid"] = os.getpid()
    return _state["wsgi"]


def application(environ, start_response):
    return _worker_app()(environ, start_response)
