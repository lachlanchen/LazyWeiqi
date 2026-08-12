# Teaching and decision-map principles

Path of Influence teaches a move as a decision, not as a colored decoration.
The learner should be able to answer three questions after inspecting a
candidate:

1. **Why here now?** Is the move urgent, large, or both?
2. **What changes?** Which liberties, groups, connections, ownership forecasts,
   and score estimates change after the stone is placed?
3. **What must I read next?** What forcing reply appears in one supplied line,
   and what concrete failure would make the plan wrong?

## The decision ladder

The teacher presents evidence in this order:

1. **Legality and exact shape.** Deterministic code checks legality, capture,
   distinct liberties, connected groups, cuts, and atari. No model can override
   these facts.
2. **Urgency.** A group with few liberties or a forcing tactical move is checked
   before a merely large open-board point. Liberty count is exact; whether the
   group is strategically urgent remains a calculation.
3. **Calculation.** A bounded KataGo principal variation supplies a move and
   one searched reply. It is a forecast, not a forced sequence. The UI exposes the
   line and the concrete risk to check.
4. **Direction and efficiency.** The explanation distinguishes making a base,
   connecting, cutting, escaping, pressuring, reducing, and taking ground. It
   relates the move to nearby groups and their exact liberties instead of
   declaring them weak or strong from a slogan.
5. **Whole-board value.** On supported 9×9 and ordinary 19×19 positions, KataGo supplies a ranked
   candidate, predicted ownership after that candidate, searched-line variation, and
   Black-perspective score/win-rate estimates. The UI also converts differences
   into the mover's perspective and labels both perspectives.

This ordering reflects established beginner strategy: corners use two existing
edges and are normally more efficient for making territory than sides or the
center; central influence can still be valuable, but it needs a target or a
later conversion. The British Go Association's beginner material explains this
[corner–side–center efficiency](https://www.britgo.org/bgj/00223.html), while
its strategy articles emphasize
[balancing influence, territory, and group strength](https://britgo.org/bgj/01210.html)
and learning the reason for a sequence instead of memorizing it
[as joseki](https://www.britgo.org/shodan/learnfromjoseki1).

These are priorities, not automatic rules. A tactical emergency can make an
ordinary-looking local move more important than the largest open corner.

## What the field visualization means

The candidate preview is a **field-map analogy**, not simulated physics:

- **Ownership after** is KataGo's Black-positive, per-intersection forecast
  after the candidate. Blue favors Black, orange favors White, and near-balanced
  or high-variation boundaries remain visibly unsettled.
- **Change field** is `ownership_after - ownership_before`. It shows where this
  particular candidate changes the forecast; it is not a distance halo around
  the new stone.
- **Tension** comes from ownership near balance and from variation among the
  continuations searched by KataGo. It means “read carefully,” not “this point
  contains mystical power” or “the model is this confident.”
- **Score forecast** is a bounded engine estimate under the declared Chinese
  area rules and komi. It is not the current count of guaranteed territory.
  KataGo's score standard deviation describes the spread of predicted final
  outcomes and is biased high; it is not an error bar on `scoreLead`.
- **Move comparison** uses the mover's signed difference from KataGo's
  order-zero candidate. The difference between the smoothed root forecast and
  an after-move forecast is described only as a forecast change, never as
  points earned by placing one stone.
- **Ground** remains distinct from potential influence. Exact enclosed regions
  and uncertain future ownership must never share the same badge.

The first supported 9×9 position visibly marks the order-zero suggestion before
the learner clicks. Any legal click creates a non-committing, rules-verified
child position and, when KataGo is available, a child-root field comparison.
The learner sees that evidence before the separate **Place stone** action is
offered; previewing never changes revision, stones, or history.

KataGo's pinned Analysis Engine contract documents per-move ownership and
searched-continuation variation through `includeMovesOwnership` and
`includeMovesOwnershipStdev`, as well as candidate score, win rate, visits,
policy, ordering, and principal variations. See the official
[KataGo v1.17.2 Analysis Engine documentation](https://github.com/lightvector/KataGo/blob/v1.17.2/docs/Analysis_Engine.md).

## Explanation contract

The interface shows a concise, evidence-backed rationale rather than hidden
model reasoning:

- **Play** — exact coordinate and a teacher-labeled hypothesis about its job.
- **Because** — exact facts, engine comparisons, and teacher interpretation kept separate.
- **Changes** — liberty/shape facts plus score and ownership forecast deltas.
- **Opponent** — the first supplied reply and a short principal variation.
- **Then check** — the failure condition or follow-up the learner should verify.
- **Principle** — one context-appropriate strategy idea and its limitation.

Every statement retains its provenance: **Exact**, **Tactical read**,
**Engine estimate**, **Teacher guidance**, **Model explanation**, or **Metaphor**. A missing engine
field stays missing; the client must not synthesize a quality score or ownership
map from stone distance.

On 19×19, a candidate also has a bounded annotated-book view. It keeps these
lanes visibly separate:

- exact resulting group shape, liberties, connections, and captures;
- calculated influence direction and territory *potential*, neither ownership
  nor secured territory;
- authored gain, trade-off, whole-board direction, response anchors, and joseki
  context, never a best-move or forced-sequence claim;
- KataGo ownership, score, policy, visits, and one searched line when a matching
  attested engine response is available.

The compact board opens a large explanation sheet with local before/after diagrams,
a whole-board fuseki miniature, numbered response branches, subsequent steps, and
conditions that should make the learner reconsider. Diagrams are rendered from
rules-verified stones and finite authored anchors; the language model cannot add a
stone, coordinate, or legal move to them.

An explicit **deep study** follows the teaching progression **Rules → Life and
Death → Tesuji → Shape → Joseki → Fuseki → Middle Game → Endgame → Positional
Judgment → Game Review**. Deterministic position signals select the relevant phase.
The larger KataGo profile supplies bounded engine evidence, and the companion's
structured response must cover why now, mechanism, gain, loss/trade-off, opponent
response space, next steps, reconsider conditions, and one transferable principle.
All generated prose remains model evidence.

## Supported boards

The dedicated HumanSL teaching lane remains hard-gated to 9×9. Ordinary 19×19
uses separately pinned general fast and quality networks with distinct model
hashes and a one-resident-at-a-time runtime. The 5×5 and 7×7 lessons remain on
rules, shape, and authored exercises and explicitly say when no engine estimate
exists. No other board size receives an engine badge without its own reviewed,
verified network contract.
