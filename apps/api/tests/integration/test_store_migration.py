from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from weiqi.adapters.store.sqlite import GameStore


def test_legacy_coach_rows_survive_exchange_schema_migration(tmp_path: Path) -> None:
    data_dir = tmp_path / "legacy-data"
    data_dir.mkdir(mode=0o700)
    database = data_dir / "weiqi.sqlite3"
    with closing(sqlite3.connect(database)) as connection:
        connection.executescript(
            """
            CREATE TABLE coach_messages (
              id TEXT PRIMARY KEY,
              game_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              source TEXT NOT NULL,
              created_at REAL NOT NULL
            );
            INSERT INTO coach_messages(
              id,game_id,node_id,role,content,source,created_at
            ) VALUES(
              'coach_legacy','game_legacy','node_legacy','assistant',
              'A visible legacy answer.','deterministic',1.0
            );
            """
        )

    store = GameStore(data_dir)
    with closing(store._connect()) as connection:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(coach_messages)")}
        version = connection.execute(
            "SELECT value FROM metadata WHERE key='schema_version'"
        ).fetchone()["value"]
        legacy = connection.execute(
            "SELECT * FROM coach_messages WHERE id='coach_legacy'"
        ).fetchone()

    assert {"question", "request_id", "request_hash", "response_json"} <= columns
    assert version == "3"
    decoded = store._coach_message(legacy)
    assert decoded["content"] == "A visible legacy answer."
    assert decoded["question"] is None
    assert decoded["response"] == {}
