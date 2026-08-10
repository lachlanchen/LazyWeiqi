from __future__ import annotations

from copy import deepcopy

import pytest

from weiqi.domain import Vertex, new_game, play
from weiqi.services.serialization import state_from_dict, state_to_dict


def test_state_roundtrip_replays_capture_history_exactly() -> None:
    state = new_game(size=5, komi=0)
    state = play(state, Vertex(1, 0), actor_id="human")
    state = play(state, Vertex(0, 0), actor_id="sparring-agent")
    state = play(state, Vertex(0, 1), actor_id="human")

    encoded = state_to_dict(state)
    restored = state_from_dict(encoded)

    assert restored == state
    assert restored.black_captures == 1
    assert restored.last_move is not None
    assert restored.last_move.captured == (Vertex(0, 0),)


def test_state_decode_rejects_history_that_does_not_match_deterministic_replay() -> None:
    state = new_game(size=5)
    state = play(state, Vertex(2, 2), actor_id="human")
    tampered = deepcopy(state_to_dict(state))
    tampered["history"][0]["candidate_id"] = "cand_00000000000000000000000000000000"
    tampered["last_move"]["candidate_id"] = "cand_00000000000000000000000000000000"

    with pytest.raises(ValueError, match="deterministic replay"):
        state_from_dict(tampered)
