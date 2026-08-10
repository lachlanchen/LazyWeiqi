from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Coroutine
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, Query, Request
from fastapi import Path as ApiPath
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .adapters.katago.process import KataGoProcess
from .adapters.localllm.client import LocalLLMClient
from .adapters.openai.client import OpenAIClient
from .adapters.store.sqlite import (
    GameNotFound,
    GameStore,
    IdempotencyConflict,
    RevisionConflict,
)
from .config import REPOSITORY_ROOT, Settings
from .domain import ActorAuthorityError, IllegalMoveError
from .schemas import (
    AgentTurnRequest,
    AnalysisRequest,
    CoachQuestion,
    GameCreate,
    GameDeleteRequest,
    GameId,
    MoveRequest,
    PreviewRequest,
    RewindRequest,
)
from .services.game_service import GameService, InvalidGameRequest
from .services.providers import TeachingProviders

MAX_JSON_BODY_BYTES = 64 * 1024


class BodyTooLarge(RuntimeError):
    pass


async def _preview_while_connected(
    request: Request,
    operation: Coroutine[Any, Any, dict[str, Any]],
) -> dict[str, Any] | None:
    """Cancel expensive read-only analysis when its browser has gone away."""

    async def wait_for_disconnect() -> None:
        # The JSON body has already been parsed. A long-lived receive is needed
        # here: Request.is_disconnected() uses an immediately-cancelled probe
        # that can miss disconnects behind Starlette's BaseHTTPMiddleware.
        while True:
            message = await request.receive()
            if message.get("type") == "http.disconnect":
                return

    task = asyncio.create_task(operation)
    disconnect_task = asyncio.create_task(wait_for_disconnect())
    try:
        done, _pending = await asyncio.wait(
            (task, disconnect_task), return_when=asyncio.FIRST_COMPLETED
        )
        if task in done:
            return task.result()
        disconnect_task.result()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return None
    finally:
        for pending_task in (task, disconnect_task):
            if not pending_task.done():
                pending_task.cancel()
        await asyncio.gather(task, disconnect_task, return_exceptions=True)


class RequestBodyLimitMiddleware:
    """Count bytes as the downstream parser consumes them; never pre-buffer the body."""

    def __init__(self, app: ASGIApp, maximum: int = MAX_JSON_BODY_BYTES) -> None:
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") in {"GET", "HEAD", "OPTIONS"}:
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                announced = int(content_length)
            except ValueError:
                await self._reject(send, 400, "invalid_content_length", "Invalid Content-Length.")
                return
            if announced < 0:
                await self._reject(send, 400, "invalid_content_length", "Invalid Content-Length.")
                return
            if announced > self.maximum:
                await self._reject(send, 413, "body_too_large", "Request body is too large.")
                return
        consumed = 0

        async def limited_receive() -> Message:
            nonlocal consumed
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > self.maximum:
                    raise BodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except BodyTooLarge:
            await self._reject(send, 413, "body_too_large", "Request body is too large.")

    @staticmethod
    async def _reject(send: Send, status: int, code: str, detail: str) -> None:
        body = json.dumps({"detail": detail, "code": code}, separators=(",", ":")).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def _error(status: int, detail: str, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, "code": code})


def _service(request: Request) -> GameService:
    return request.app.state.game_service


def _game_id(value: str) -> str:
    return value


def _validated_web_dist(path: Path) -> Path | None:
    web_root = path.parent
    if web_root.is_symlink() or not web_root.is_dir():
        raise RuntimeError("apps/web must be a real project directory")
    if path.is_symlink():
        raise RuntimeError("apps/web/dist must not be a symbolic link")
    if not path.exists():
        return None
    if not path.is_dir():
        raise RuntimeError("apps/web/dist must be a directory")
    expected = web_root.resolve(strict=True) / path.name
    if path.resolve(strict=True) != expected:
        raise RuntimeError("apps/web/dist resolves outside its project directory")
    return path


def _web_dist() -> Path | None:
    return _validated_web_dist(REPOSITORY_ROOT / "apps/web/dist")


def create_app(
    settings_override: Settings | None = None,
    *,
    store: GameStore | None = None,
    katago: KataGoProcess | None = None,
    openai: OpenAIClient | None = None,
    local: LocalLLMClient | None = None,
) -> FastAPI:
    configured = settings_override or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        data_dir = configured.prepare_data_dir()
        resolved_store = store or GameStore(data_dir)
        resolved_katago = katago or KataGoProcess(configured)
        resolved_openai = openai or OpenAIClient(configured)
        resolved_local = local or LocalLLMClient(configured)
        providers = TeachingProviders(
            resolved_openai,
            resolved_local,
            allow_local_prose=configured.localllm_prose_coaching_enabled,
        )
        app.state.settings = configured
        app.state.game_store = resolved_store
        app.state.katago = resolved_katago
        app.state.openai = resolved_openai
        app.state.localllm = resolved_local
        app.state.providers = providers
        app.state.game_service = GameService(resolved_store, resolved_katago, providers)
        try:
            yield
        finally:
            await app.state.game_service.close()
            await resolved_katago.close()
            await resolved_openai.close()
            await resolved_local.close()

    app = FastAPI(
        title="Path of Influence · Weiqi teaching API",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(RequestBodyLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5174", "http://localhost:5174"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost", "testserver"],
    )

    @app.middleware("http")
    async def browser_security_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        )
        if request.url.path.startswith("/api/") or request.url.path in {
            "/healthz",
            "/openapi.json",
        }:
            response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; base-uri 'none'; object-src 'none'; "
            "frame-ancestors 'none'; form-action 'self'; script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "font-src 'self' data:; connect-src 'self'",
        )
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return _error(
            422, "The request did not match the teaching API contract.", "invalid_request"
        )

    @app.exception_handler(GameNotFound)
    async def game_not_found(_request: Request, _exc: GameNotFound) -> JSONResponse:
        return _error(404, "That game or branch does not exist.", "not_found")

    @app.exception_handler(RevisionConflict)
    async def revision_conflict(_request: Request, _exc: RevisionConflict) -> JSONResponse:
        return _error(
            409, "The game changed. Reload its latest position before acting.", "revision_conflict"
        )

    @app.exception_handler(IdempotencyConflict)
    async def idempotency_conflict(_request: Request, _exc: IdempotencyConflict) -> JSONResponse:
        return _error(
            409,
            "That request key was already used for a different action.",
            "idempotency_conflict",
        )

    @app.exception_handler(IllegalMoveError)
    async def illegal_move(_request: Request, exc: IllegalMoveError) -> JSONResponse:
        return _error(409, str(exc), exc.reason.value)

    @app.exception_handler(ActorAuthorityError)
    async def actor_error(_request: Request, exc: ActorAuthorityError) -> JSONResponse:
        return _error(403, str(exc), "actor_not_authorized")

    @app.exception_handler(InvalidGameRequest)
    async def invalid_game(_request: Request, exc: InvalidGameRequest) -> JSONResponse:
        return _error(400, str(exc), "invalid_game_request")

    @app.get("/healthz")
    async def healthz() -> dict[str, Any]:
        return {"ok": True, "service": "weiqi", "version": "0.1.0"}

    @app.get("/api/status")
    async def status(request: Request) -> dict[str, Any]:
        service = _service(request)
        engine = await service.katago.status()
        try:
            providers = await asyncio.wait_for(service.providers.status(), timeout=7.0)
        except (asyncio.TimeoutError, TimeoutError):
            providers = {
                "openai": {"available": False, "configured": True},
                "localllm": {"available": False},
            }
        openai_status = providers["openai"]
        local_status = providers["localllm"]
        if openai_status.get("available"):
            coach_status = {
                "status": "ready",
                "provider": "GPT-5.6 Sol",
                "model": openai_status.get("model", configured.openai_model),
                "detail": "Quality-first companion; only bounded board evidence is sent.",
            }
        elif local_status.get("available") and local_status.get("coach_ready"):
            coach_status = {
                "status": "fallback",
                "provider": "LocalLLM",
                "model": local_status.get("coach_model", configured.coach_model),
                "detail": "OpenAI is unavailable; the private local companion remains ready.",
            }
        else:
            coach_status = {
                "status": "fallback",
                "provider": "Deterministic companion",
                "model": None,
                "detail": "Exact rules and authored teaching remain available without a model.",
            }
        engine_status = {
            "status": "ready" if engine["available"] else "fallback",
            "provider": "KataGo" if engine["available"] else "Exact board rules",
            "model": engine["network"] if engine["available"] else None,
            "detail": (
                "KataGo analysis starts only when requested."
                if engine["available"]
                else (
                    "KataGo is not installed yet; exact board mechanics remain available, "
                    "while move-purpose guidance is authored by the teacher layer."
                )
            ),
        }
        return {
            "status": "ready" if engine["available"] else "degraded",
            "service": "weiqi",
            "version": "0.1.0",
            "engine": engine_status,
            "coach": coach_status,
            "supported_board_sizes": [5, 7, 9],
        }

    @app.get("/api/curriculum")
    async def curriculum(request: Request) -> dict[str, Any]:
        return _service(request).curriculum()

    @app.get("/api/games")
    async def games(
        request: Request,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        cursor: Annotated[str | None, Query(min_length=1, max_length=160)] = None,
    ) -> dict[str, Any]:
        return _service(request).list_games(limit=limit, cursor=cursor)

    @app.post("/api/games", status_code=201)
    async def create_game(payload: GameCreate, request: Request) -> dict[str, Any]:
        return _service(request).create_game(payload)

    @app.get("/api/games/{game_id}")
    async def get_game(game_id: Annotated[GameId, ApiPath()], request: Request) -> dict[str, Any]:
        return _service(request).game(_game_id(game_id))

    @app.delete("/api/games/{game_id}")
    async def delete_game(
        game_id: Annotated[GameId, ApiPath()], payload: GameDeleteRequest, request: Request
    ) -> dict[str, Any]:
        return _service(request).delete_game(_game_id(game_id), payload.expected_revision)

    @app.get("/api/games/{game_id}/coach-history")
    async def coach_history(
        game_id: Annotated[GameId, ApiPath()],
        request: Request,
        limit: Annotated[int, Query(ge=1, le=80)] = 80,
        cursor: Annotated[str | None, Query(min_length=1, max_length=512)] = None,
    ) -> dict[str, Any]:
        return _service(request).coach_history(_game_id(game_id), limit=limit, cursor=cursor)

    @app.post("/api/games/{game_id}/preview")
    async def preview_move(
        game_id: Annotated[GameId, ApiPath()], payload: PreviewRequest, request: Request
    ) -> Any:
        result = await _preview_while_connected(
            request,
            _service(request).preview(_game_id(game_id), payload),
        )
        if result is None:
            return JSONResponse(
                status_code=499,
                content={
                    "code": "client_closed_request",
                    "detail": "Preview analysis stopped because the browser cancelled it.",
                },
            )
        return result

    @app.post("/api/games/{game_id}/analysis")
    async def analyze_game(
        game_id: Annotated[GameId, ApiPath()], payload: AnalysisRequest, request: Request
    ) -> dict[str, Any]:
        return await _service(request).analysis_response(
            _game_id(game_id), payload.expected_revision
        )

    @app.post("/api/games/{game_id}/moves")
    async def submit_move(
        game_id: Annotated[GameId, ApiPath()], payload: MoveRequest, request: Request
    ) -> dict[str, Any]:
        return _service(request).submit_move(_game_id(game_id), payload)

    @app.post("/api/games/{game_id}/agent-turn")
    async def agent_turn(
        game_id: Annotated[GameId, ApiPath()], payload: AgentTurnRequest, request: Request
    ) -> dict[str, Any]:
        return await _service(request).agent_turn(_game_id(game_id), payload)

    @app.post("/api/games/{game_id}/rewind")
    async def rewind(
        game_id: Annotated[GameId, ApiPath()], payload: RewindRequest, request: Request
    ) -> dict[str, Any]:
        return _service(request).rewind(_game_id(game_id), payload)

    @app.post("/api/games/{game_id}/coach")
    async def coach(
        game_id: Annotated[GameId, ApiPath()], payload: CoachQuestion, request: Request
    ) -> dict[str, Any]:
        return await _service(request).coach(_game_id(game_id), payload)

    web_dist = _web_dist()
    if web_dist is not None:
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    else:

        @app.get("/")
        async def root() -> dict[str, str]:
            return {
                "service": "Path of Influence",
                "detail": "Build apps/web or run the Vite development server on port 5174.",
            }

    return app


app = create_app()
