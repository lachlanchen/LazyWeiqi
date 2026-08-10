from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  board_size INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  player_color TEXT NOT NULL,
  black_persona TEXT NOT NULL,
  white_persona TEXT NOT NULL,
  companion_enabled INTEGER NOT NULL,
  companion_style TEXT NOT NULL DEFAULT 'socratic',
  rank_profile TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  current_node_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  result TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS game_nodes (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES game_nodes(id),
  ply INTEGER NOT NULL,
  actor TEXT NOT NULL,
  move_json TEXT,
  state_json TEXT NOT NULL,
  impact_json TEXT NOT NULL,
  coach_json TEXT,
  created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_nodes_game_ply
  ON game_nodes(game_id, ply, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL REFERENCES game_nodes(id),
  created_at REAL NOT NULL,
  PRIMARY KEY (game_id, request_id)
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES game_nodes(id),
  role TEXT NOT NULL,
  question TEXT,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  request_id TEXT,
  request_hash TEXT,
  response_json TEXT,
  created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coach_game_created
  ON coach_messages(game_id, created_at);
"""


class RevisionConflict(RuntimeError):
    pass


class IdempotencyConflict(RuntimeError):
    pass


class GameNotFound(KeyError):
    pass


class GameStore:
    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / "weiqi.sqlite3"
        self._reject_unsafe_database_paths()
        self._initialize()

    def _reject_unsafe_database_paths(self) -> None:
        if self.path.parent.is_symlink() or not self.path.parent.is_dir():
            raise ValueError("database directory must be a real directory")
        for candidate in (self.path, Path(f"{self.path}-wal"), Path(f"{self.path}-shm")):
            if candidate.is_symlink():
                raise ValueError("database files must not be symbolic links")
            if candidate.exists() and not candidate.is_file():
                raise ValueError("database path must be a regular file")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def _initialize(self) -> None:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.executescript(SCHEMA)
            idempotency_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(idempotency_keys)").fetchall()
            }
            if "request_hash" not in idempotency_columns:
                connection.execute(
                    "ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''"
                )
            game_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(games)").fetchall()
            }
            if "companion_style" not in game_columns:
                connection.execute(
                    "ALTER TABLE games ADD COLUMN companion_style TEXT NOT NULL DEFAULT 'socratic'"
                )
            coach_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(coach_messages)").fetchall()
            }
            for name, declaration in (
                ("question", "TEXT"),
                ("request_id", "TEXT"),
                ("request_hash", "TEXT"),
                ("response_json", "TEXT"),
            ):
                if name not in coach_columns:
                    connection.execute(
                        f"ALTER TABLE coach_messages ADD COLUMN {name} {declaration}"
                    )
            connection.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_game_request
                ON coach_messages(game_id,request_id)
                WHERE request_id IS NOT NULL
                """
            )
            connection.execute(
                "INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version','3')"
            )
        os.chmod(self.path, 0o600)
        for suffix in ("-wal", "-shm"):
            sibling = Path(f"{self.path}{suffix}")
            if sibling.exists():
                os.chmod(sibling, 0o600)

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    @staticmethod
    def _node(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "parent_id": row["parent_id"],
            "ply": row["ply"],
            "actor": row["actor"],
            "move": json.loads(row["move_json"]) if row["move_json"] else None,
            "state": json.loads(row["state_json"]),
            "impact": json.loads(row["impact_json"]),
            "coach": json.loads(row["coach_json"]) if row["coach_json"] else None,
            "created_at": row["created_at"],
        }

    @staticmethod
    def _coach_message(row: sqlite3.Row) -> dict[str, Any]:
        response = json.loads(row["response_json"]) if row["response_json"] else {}
        if not isinstance(response, dict):
            raise ValueError("stored coach response metadata is invalid")
        return {
            "id": row["id"],
            "game_id": row["game_id"],
            "node_id": row["node_id"],
            "role": row["role"],
            "question": row["question"],
            "content": row["content"],
            "source": row["source"],
            "request_id": row["request_id"],
            "request_hash": row["request_hash"],
            "response": response,
            "created_at": row["created_at"],
        }

    def create_game(
        self,
        *,
        metadata: dict[str, Any],
        root_state: dict[str, Any],
        root_impact: dict[str, Any],
        root_coach: dict[str, Any] | None,
    ) -> dict[str, Any]:
        game_id = f"game_{uuid.uuid4().hex}"
        node_id = f"node_{uuid.uuid4().hex}"
        now = time.time()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute(
                    """
                    INSERT INTO games(
                      id,title,board_size,lesson_id,mode,player_color,
                      black_persona,white_persona,companion_enabled,companion_style,rank_profile,
                      root_node_id,current_node_id,revision,result,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,?,?)
                    """,
                    (
                        game_id,
                        metadata["title"],
                        metadata["board_size"],
                        metadata["lesson_id"],
                        metadata["mode"],
                        metadata["player_color"],
                        metadata["black_persona"],
                        metadata["white_persona"],
                        1 if metadata["companion_enabled"] else 0,
                        metadata["companion_style"],
                        metadata["rank_profile"],
                        node_id,
                        node_id,
                        now,
                        now,
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO game_nodes(
                      id,game_id,parent_id,ply,actor,move_json,state_json,impact_json,coach_json,created_at
                    ) VALUES(?,?,NULL,0,'system',NULL,?,?,?,?)
                    """,
                    (
                        node_id,
                        game_id,
                        self._json(root_state),
                        self._json(root_impact),
                        self._json(root_coach) if root_coach else None,
                        now,
                    ),
                )
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        game = self.get_game(game_id)
        if game is None:
            raise RuntimeError("created game could not be loaded")
        return game

    def list_games(
        self,
        limit: int = 50,
        *,
        before_updated_at: float | None = None,
        before_id: str | None = None,
    ) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(limit, 101))
        where = ""
        parameters: tuple[Any, ...]
        if before_updated_at is None:
            parameters = (bounded_limit,)
        else:
            if before_id is None:
                raise ValueError("a game-list cursor requires both timestamp and id")
            where = "WHERE updated_at < ? OR (updated_at = ? AND id < ?)"
            parameters = (before_updated_at, before_updated_at, before_id, bounded_limit)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"""
                SELECT id,title,board_size,lesson_id,mode,player_color,black_persona,
                       white_persona,companion_enabled,companion_style,rank_profile,current_node_id,
                       revision,result,created_at,updated_at
                FROM games {where} ORDER BY updated_at DESC,id DESC LIMIT ?
                """,
                parameters,
            ).fetchall()
        return [
            {
                **dict(row),
                "companion_enabled": bool(row["companion_enabled"]),
            }
            for row in rows
        ]

    def get_game(self, game_id: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            game = connection.execute("SELECT * FROM games WHERE id=?", (game_id,)).fetchone()
            if game is None:
                return None
            current = connection.execute(
                "SELECT * FROM game_nodes WHERE id=? AND game_id=?",
                (game["current_node_id"], game_id),
            ).fetchone()
            nodes = connection.execute(
                "SELECT * FROM game_nodes WHERE game_id=? ORDER BY created_at,ply",
                (game_id,),
            ).fetchall()
            coach_rows = connection.execute(
                "SELECT * FROM coach_messages WHERE game_id=? ORDER BY created_at",
                (game_id,),
            ).fetchall()
        if current is None:
            raise RuntimeError("game current node is missing")
        return {
            **dict(game),
            "companion_enabled": bool(game["companion_enabled"]),
            "current_node": self._node(current),
            "nodes": [self._node(row) for row in nodes],
            "coach_messages": [self._coach_message(row) for row in coach_rows],
        }

    def delete_game(self, game_id: str, expected_revision: int) -> None:
        """Delete exactly one revision-matched game and its owned rows atomically."""

        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                game = connection.execute(
                    "SELECT revision FROM games WHERE id=?", (game_id,)
                ).fetchone()
                if game is None:
                    raise GameNotFound(game_id)
                if game["revision"] != expected_revision:
                    raise RevisionConflict("the game changed in another request")
                deleted = connection.execute(
                    "DELETE FROM games WHERE id=? AND revision=?",
                    (game_id, expected_revision),
                )
                if deleted.rowcount != 1:
                    raise RevisionConflict("the game changed in another request")
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise

    def coach_exchange(
        self, game_id: str, request_id: str, request_hash: str
    ) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            existing = connection.execute(
                "SELECT * FROM coach_messages WHERE game_id=? AND request_id=?",
                (game_id, request_id),
            ).fetchone()
        if existing is None:
            return None
        if not existing["request_hash"] or existing["request_hash"] != request_hash:
            raise IdempotencyConflict("the idempotency key was already used for another request")
        return self._coach_message(existing)

    def idempotent_game(
        self, game_id: str, request_id: str, request_hash: str
    ) -> dict[str, Any] | None:
        """Return the current game for an exact retry of a committed request.

        A caller-controlled key cannot be reused for different request semantics.
        Legacy rows created before request fingerprints were added are intentionally
        not accepted as verified retries.
        """

        with closing(self._connect()) as connection:
            existing = connection.execute(
                "SELECT request_hash FROM idempotency_keys WHERE game_id=? AND request_id=?",
                (game_id, request_id),
            ).fetchone()
        if existing is None:
            return None
        if not existing["request_hash"] or existing["request_hash"] != request_hash:
            raise IdempotencyConflict("the idempotency key was already used for another request")
        loaded = self.get_game(game_id)
        if loaded is None:
            raise GameNotFound(game_id)
        return loaded

    def append_node(
        self,
        *,
        game_id: str,
        expected_revision: int,
        request_id: str,
        request_hash: str,
        actor: str,
        move: dict[str, Any],
        state: dict[str, Any],
        impact: dict[str, Any],
        coach: dict[str, Any] | None,
        result: str | None = None,
    ) -> dict[str, Any]:
        now = time.time()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT node_id,request_hash FROM idempotency_keys WHERE game_id=? AND request_id=?",
                    (game_id, request_id),
                ).fetchone()
                if existing:
                    if not existing["request_hash"] or existing["request_hash"] != request_hash:
                        raise IdempotencyConflict(
                            "the idempotency key was already used for another request"
                        )
                    connection.execute("COMMIT")
                    loaded = self.get_game(game_id)
                    if loaded is None:
                        raise GameNotFound(game_id)
                    return loaded
                game = connection.execute(
                    "SELECT current_node_id,revision FROM games WHERE id=?", (game_id,)
                ).fetchone()
                if game is None:
                    raise GameNotFound(game_id)
                if game["revision"] != expected_revision:
                    raise RevisionConflict("the game changed in another request")
                parent = connection.execute(
                    "SELECT ply FROM game_nodes WHERE id=?", (game["current_node_id"],)
                ).fetchone()
                if parent is None:
                    raise RuntimeError("game current node is missing")
                node_id = f"node_{uuid.uuid4().hex}"
                connection.execute(
                    """
                    INSERT INTO game_nodes(
                      id,game_id,parent_id,ply,actor,move_json,state_json,impact_json,coach_json,created_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        node_id,
                        game_id,
                        game["current_node_id"],
                        parent["ply"] + 1,
                        actor,
                        self._json(move),
                        self._json(state),
                        self._json(impact),
                        self._json(coach) if coach else None,
                        now,
                    ),
                )
                connection.execute(
                    "INSERT INTO idempotency_keys(game_id,request_id,request_hash,node_id,created_at) VALUES(?,?,?,?,?)",
                    (game_id, request_id, request_hash, node_id, now),
                )
                updated = connection.execute(
                    """
                    UPDATE games SET current_node_id=?,revision=revision+1,updated_at=?,
                                     result=COALESCE(?,result)
                    WHERE id=? AND revision=?
                    """,
                    (node_id, now, result, game_id, expected_revision),
                )
                if updated.rowcount != 1:
                    raise RevisionConflict("the game changed in another request")
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        loaded = self.get_game(game_id)
        if loaded is None:
            raise GameNotFound(game_id)
        return loaded

    def rewind(self, game_id: str, node_id: str, expected_revision: int) -> dict[str, Any]:
        now = time.time()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                game = connection.execute(
                    "SELECT revision FROM games WHERE id=?", (game_id,)
                ).fetchone()
                if game is None:
                    raise GameNotFound(game_id)
                if game["revision"] != expected_revision:
                    raise RevisionConflict("the game changed in another request")
                node = connection.execute(
                    "SELECT id FROM game_nodes WHERE id=? AND game_id=?", (node_id, game_id)
                ).fetchone()
                if node is None:
                    raise GameNotFound(node_id)
                updated = connection.execute(
                    "UPDATE games SET current_node_id=?,revision=revision+1,updated_at=?,result=NULL WHERE id=? AND revision=?",
                    (node_id, now, game_id, expected_revision),
                )
                if updated.rowcount != 1:
                    raise RevisionConflict("the game changed in another request")
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        loaded = self.get_game(game_id)
        if loaded is None:
            raise GameNotFound(game_id)
        return loaded

    def add_coach_message(
        self,
        *,
        game_id: str,
        node_id: str,
        expected_revision: int,
        expected_current_node_id: str,
        role: str,
        content: str,
        source: str,
    ) -> dict[str, Any]:
        message_id = f"coach_{uuid.uuid4().hex}"
        now = time.time()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                game = connection.execute(
                    "SELECT revision,current_node_id FROM games WHERE id=?", (game_id,)
                ).fetchone()
                if game is None:
                    raise GameNotFound(game_id)
                if (
                    game["revision"] != expected_revision
                    or game["current_node_id"] != expected_current_node_id
                    or node_id != expected_current_node_id
                ):
                    raise RevisionConflict("the position changed while coaching was generated")
                connection.execute(
                    """
                    INSERT INTO coach_messages(id,game_id,node_id,role,content,source,created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (message_id, game_id, node_id, role, content, source, now),
                )
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        return {
            "id": message_id,
            "game_id": game_id,
            "node_id": node_id,
            "role": role,
            "content": content,
            "source": source,
            "created_at": now,
        }

    def add_coach_exchange(
        self,
        *,
        game_id: str,
        node_id: str,
        expected_revision: int,
        expected_current_node_id: str,
        request_id: str,
        request_hash: str,
        question: str,
        content: str,
        source: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        message_id = f"coach_{uuid.uuid4().hex}"
        now = time.time()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM coach_messages WHERE game_id=? AND request_id=?",
                    (game_id, request_id),
                ).fetchone()
                if existing is not None:
                    if not existing["request_hash"] or existing["request_hash"] != request_hash:
                        raise IdempotencyConflict(
                            "the idempotency key was already used for another request"
                        )
                    connection.execute("COMMIT")
                    return self._coach_message(existing)

                game = connection.execute(
                    "SELECT revision,current_node_id FROM games WHERE id=?", (game_id,)
                ).fetchone()
                if game is None:
                    raise GameNotFound(game_id)
                if (
                    game["revision"] != expected_revision
                    or game["current_node_id"] != expected_current_node_id
                    or node_id != expected_current_node_id
                ):
                    raise RevisionConflict("the position changed while coaching was generated")
                connection.execute(
                    """
                    INSERT INTO coach_messages(
                      id,game_id,node_id,role,question,content,source,
                      request_id,request_hash,response_json,created_at
                    ) VALUES(?,?,?,'assistant',?,?,?,?,?,?,?)
                    """,
                    (
                        message_id,
                        game_id,
                        node_id,
                        question,
                        content,
                        source,
                        request_id,
                        request_hash,
                        self._json(response),
                        now,
                    ),
                )
                updated = connection.execute(
                    """
                    UPDATE games SET updated_at=?
                    WHERE id=? AND revision=? AND current_node_id=?
                    """,
                    (now, game_id, expected_revision, expected_current_node_id),
                )
                if updated.rowcount != 1:
                    raise RevisionConflict("the position changed while coaching was generated")
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        stored = self.coach_exchange(game_id, request_id, request_hash)
        if stored is None:
            raise RuntimeError("committed coach exchange could not be loaded")
        return stored
