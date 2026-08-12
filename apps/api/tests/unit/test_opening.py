from __future__ import annotations

from weiqi.domain import (
    CandidateSelection,
    Color,
    MoveKind,
    Vertex,
    apply_candidate,
    candidate_for_action,
    explain_move_impact,
    legal_candidates,
    new_game,
    opening_teaching,
    vertex_to_gtp,
)


def test_immediate_reply_anchors_are_rules_legal_but_followups_remain_authored() -> None:
    # After Black D16, White F17 is empty but suicidal: E17, G17, F18,
    # and F16 are all Black. It must not be presented as an immediate reply.
    state = new_game(
        size=19,
        to_move=Color.BLACK,
        initial_black=(
            Vertex(4, 2),  # E17
            Vertex(6, 2),  # G17
            Vertex(5, 1),  # F18
            Vertex(5, 3),  # F16
        ),
    )
    candidate = candidate_for_action(state, MoveKind.PLAY, Vertex(3, 3))
    after = apply_candidate(
        state,
        CandidateSelection(
            state_token=state.state_token,
            candidate_id=candidate.id,
            actor_id=state.actors.player_for(Color.BLACK).id,
        ),
    )
    teaching = opening_teaching(
        state,
        candidate,
        "m_" + candidate.id.removeprefix("cand_"),
        after,
        explain_move_impact(state, after),
    )

    assert teaching is not None
    legal_replies = {
        vertex_to_gtp(item.vertex, 19)
        for item in legal_candidates(after, include_pass=False)
        if item.vertex is not None
    }
    reply_coordinates = {item["coordinate"] for item in teaching["reply_anchors"]}
    assert "F17" not in reply_coordinates
    assert reply_coordinates <= legal_replies
    assert all(
        item["legality_scope"] == "immediate_opponent_response"
        and item["current_legality_checked"] is True
        for item in teaching["reply_anchors"]
    )
    assert all(
        item["evidence"] == "authored"
        and item["timing_id"] == "future_big_point"
        and item["legality_scope"] == "authored_future_not_current_legality"
        and item["current_legality_checked"] is False
        for item in teaching["follow_ups"]
    )
