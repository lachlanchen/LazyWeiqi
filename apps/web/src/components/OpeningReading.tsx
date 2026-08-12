import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, BookOpen, BrainCircuit, GitBranch, Map, ShieldCheck, Sparkles, X } from 'lucide-react'
import { pointKey, samePoint } from '../board'
import { openingCopyKey, useI18n, type MessageKey } from '../i18n'
import type { BoardSize, CandidateMove, OpeningEngineProvenance, OpeningTeaching, OpeningTeachingAnchor, OpeningTeachingDiagram, Point, Stone, StoneColor } from '../types'

const ZONE_KEYS = {
  corner: 'opening.zone.corner',
  side: 'opening.zone.side',
  center: 'opening.zone.center',
} as const satisfies Record<OpeningTeaching['territory']['zones'][number]['kind'], MessageKey>

const POTENTIAL_KEYS = {
  efficient: 'opening.region.efficient',
  developing: 'opening.region.developing',
  open: 'opening.region.open',
} as const satisfies Record<OpeningTeaching['territory']['zones'][number]['potential'], MessageKey>

const ANCHOR_KEYS = {
  extension: 'opening.anchor.extension',
  approach: 'opening.anchor.approach',
  reply: 'opening.anchor.reply',
  direction: 'opening.anchor.direction',
} as const satisfies Record<OpeningTeachingAnchor['role'], MessageKey>

const JOSEKI_KEYS = {
  entry_point: 'opening.joseki.entryPoint',
  context: 'opening.joseki.context',
  not_applicable: 'opening.joseki.notApplicable',
} as const satisfies Record<OpeningTeaching['joseki']['relation'], MessageKey>

function localizedCopy(
  id: string | undefined,
  t: ReturnType<typeof useI18n>['t'],
  fallback: string,
  values?: Record<string, string | number>,
): string {
  const key = id ? openingCopyKey(id) : null
  return key ? t(key, values) : fallback
}

interface OpeningReadingProps {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  candidate: CandidateMove
  teaching: OpeningTeaching
  onDeepStudy?: () => void
  deepStudyBusy?: boolean
}

/**
 * Keep the modal action deliberately narrow: it may request explanation and
 * close the overlay, but receives no move-commit capability.
 */
export function requestOpeningDeepStudy(onDeepStudy: () => void, close: () => void): void {
  try {
    onDeepStudy()
  } finally {
    close()
  }
}

function displaySummaries(teaching: OpeningTeaching, t: ReturnType<typeof useI18n>['t']) {
  const exact = teaching.mechanism.exact
  const primaryZone = teaching.territory.zones[0]
  const region = primaryZone ? t(ZONE_KEYS[primaryZone.kind]) : t('opening.zone.corner')
  const shape = t('opening.shapeFacts', {
    region,
    line: exact.line_from_nearest_edge,
    liberties: exact.resulting_liberties,
    connections: exact.connections,
  })
  const territory = teaching.territory.zones.length
    ? teaching.territory.zones.slice(0, 2).map((zone) => t('opening.territoryFacts', {
        zone: t(ZONE_KEYS[zone.kind]),
        potential: t(POTENTIAL_KEYS[zone.potential]),
      })).join(' · ')
    : t('opening.territoryHelp')
  const influence = t('opening.influenceFacts', { count: teaching.influence.vectors.length })
  const joseki = t(JOSEKI_KEYS[teaching.joseki.relation])
  return { shape, territory, influence, joseki }
}

function stonesAfterCandidate(stones: Stone[], candidate: CandidateMove, toPlay: StoneColor): Stone[] {
  if (!candidate.point || candidate.kind === 'pass') return stones
  return verifiedAfterStones(stones, candidate.point, toPlay, exactCandidateCaptures(candidate))
}

function exactCandidateCaptures(candidate: CandidateMove): Point[] {
  return candidate.legal_verified && candidate.tactics?.evidence === 'exact'
    ? candidate.tactics.captures
    : []
}

/**
 * Build the one position that an after-candidate diagram is allowed to show:
 * verified current stones, minus exact captures, plus the still-uncommitted
 * candidate. The returned array is new, so before/current diagrams stay intact.
 */
export function verifiedAfterStones(
  current: ReadonlyArray<Stone>,
  candidatePoint: Point,
  candidateColor: StoneColor,
  exactCaptures: ReadonlyArray<Point>,
): Stone[] {
  const captured = new Set(exactCaptures.map(pointKey))
  return [
    ...current.filter((stone) => !captured.has(pointKey(stone))),
    { ...candidatePoint, color: candidateColor },
  ]
}

export function LocalShapeDiagram({
  size,
  stones,
  toPlay,
  candidate,
  after,
  label,
}: {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  candidate: CandidateMove
  after: boolean
  label: string
}) {
  const point = candidate.point
  if (!point) return null
  const radius = 4
  let minX = Math.max(0, point.x - radius)
  let maxX = Math.min(size - 1, point.x + radius)
  let minY = Math.max(0, point.y - radius)
  let maxY = Math.min(size - 1, point.y + radius)
  if (maxX - minX < radius * 2) {
    if (minX === 0) maxX = Math.min(size - 1, radius * 2)
    else minX = Math.max(0, size - 1 - radius * 2)
  }
  if (maxY - minY < radius * 2) {
    if (minY === 0) maxY = Math.min(size - 1, radius * 2)
    else minY = Math.max(0, size - 1 - radius * 2)
  }
  const margin = 20
  const grid = 180
  const xStep = grid / Math.max(1, maxX - minX)
  const yStep = grid / Math.max(1, maxY - minY)
  const xAt = (x: number) => margin + (x - minX) * xStep
  const yAt = (y: number) => margin + (y - minY) * yStep
  const suppliedDiagram = candidate.opening_teaching?.teaching_diagrams.find((diagram) =>
    diagram.crop.min_x === minX &&
    diagram.crop.min_y === minY &&
    diagram.crop.max_x === maxX &&
    diagram.crop.max_y === maxY,
  ) ?? candidate.opening_teaching?.teaching_diagrams.find((diagram) => diagram.diagram_type.includes('local'))
  const verifiedCurrentStones = suppliedDiagram?.verified_current_stones.map((item) => ({ ...item.point, color: item.color })) ?? stones
  const diagramStones = after
    ? suppliedDiagram
      ? verifiedAfterStones(
          verifiedCurrentStones,
          suppliedDiagram.candidate.point,
          suppliedDiagram.candidate.color,
          exactCandidateCaptures(candidate),
        )
      : stonesAfterCandidate(stones, candidate, toPlay)
    : verifiedCurrentStones
  // On the current milestone's empty-board opening, the exact rules lane
  // verifies a single-stone group. Only in that bounded case may the diagram
  // derive and draw the four orthogonal liberties itself.
  const exactSingleStoneOpening = stones.length === 0 &&
    candidate.legal_verified &&
    candidate.tactics?.evidence === 'exact' &&
    candidate.tactics.resulting_group_size === 1 &&
    candidate.tactics.resulting_liberties === 4
  const suppliedExactLiberties = suppliedDiagram && suppliedDiagram.candidate.point.x === point.x && suppliedDiagram.candidate.point.y === point.y
    ? candidate.tactics?.resulting_liberties === 4 && candidate.tactics?.resulting_group_size === 1
    : false
  const previewLiberties = after && (exactSingleStoneOpening || suppliedExactLiberties)
    ? [
        { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y },
        { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 },
      ].filter((liberty) => liberty.x >= 0 && liberty.x < size && liberty.y >= 0 && liberty.y < size)
    : []
  const connectionPoints = after ? candidate.tactics?.connects ?? [] : []
  const cutPoints = after ? candidate.tactics?.cuts ?? [] : []

  return (
    <svg viewBox="0 0 220 220" role="img" aria-label={label} className="opening-book-diagram local-shape-diagram" data-state={after ? 'after' : 'before'}>
      <title>{label}</title>
      <rect x="2" y="2" width="216" height="216" rx="18" className="diagram-board" />
      {Array.from({ length: maxX - minX + 1 }, (_, index) => minX + index).map((x) => (
        <line key={`x-${x}`} x1={xAt(x)} y1={margin} x2={xAt(x)} y2={margin + grid} className="diagram-line" />
      ))}
      {Array.from({ length: maxY - minY + 1 }, (_, index) => minY + index).map((y) => (
        <line key={`y-${y}`} x1={margin} y1={yAt(y)} x2={margin + grid} y2={yAt(y)} className="diagram-line" />
      ))}
      {previewLiberties.filter((liberty) => liberty.x >= minX && liberty.x <= maxX && liberty.y >= minY && liberty.y <= maxY).map((liberty) => (
        <circle key={`liberty-${pointKey(liberty)}`} cx={xAt(liberty.x)} cy={yAt(liberty.y)} r="5" className="diagram-liberty" />
      ))}
      {connectionPoints.filter((anchor) => anchor.x >= minX && anchor.x <= maxX && anchor.y >= minY && anchor.y <= maxY).map((anchor) => (
        <line key={`connect-${pointKey(anchor)}`} x1={xAt(point.x)} y1={yAt(point.y)} x2={xAt(anchor.x)} y2={yAt(anchor.y)} className="diagram-connect" />
      ))}
      {cutPoints.filter((anchor) => anchor.x >= minX && anchor.x <= maxX && anchor.y >= minY && anchor.y <= maxY).map((anchor) => (
        <line key={`cut-${pointKey(anchor)}`} x1={xAt(point.x)} y1={yAt(point.y)} x2={xAt(anchor.x)} y2={yAt(anchor.y)} className="diagram-cut" />
      ))}
      {diagramStones.filter((stone) => stone.x >= minX && stone.x <= maxX && stone.y >= minY && stone.y <= maxY).map((stone) => {
        const candidateStone = after && samePoint(stone, point)
        return (
          <circle
            key={`stone-${pointKey(stone)}`}
            cx={xAt(stone.x)}
            cy={yAt(stone.y)}
            r={Math.min(xStep, yStep) * 0.42}
            className={`diagram-stone ${stone.color} ${candidateStone ? 'preview' : ''}`}
            data-point={pointKey(stone)}
            data-stone-state={candidateStone ? 'candidate-preview' : after ? 'verified-after' : 'verified-current'}
          />
        )
      })}
      {!after && <circle cx={xAt(point.x)} cy={yAt(point.y)} r={Math.min(xStep, yStep) * 0.34} className="diagram-target" />}
    </svg>
  )
}

export function WholeBoardDiagram({
  size,
  stones,
  toPlay,
  candidate,
  teaching,
  label,
  anchorLabel,
}: {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  candidate: CandidateMove
  teaching: OpeningTeaching
  label: string
  anchorLabel: (item: { role: string; coordinate: string; order: number }) => string
}) {
  const margin = 16
  const span = 208
  const step = span / (size - 1)
  const at = (point: Point) => ({ x: margin + point.x * step, y: margin + point.y * step })
  const anchors = [...teaching.follow_ups, ...teaching.reply_anchors]
  const candidatePoint = candidate.point
  const suppliedWholeBoard = teaching.teaching_diagrams.find((diagram) => diagram.diagram_type.includes('whole'))
  const verifiedCurrentStones = suppliedWholeBoard?.verified_current_stones.map((item) => ({ ...item.point, color: item.color })) ?? stones
  const verifiedStones = candidatePoint
    ? verifiedAfterStones(
        verifiedCurrentStones,
        suppliedWholeBoard?.candidate.point ?? candidatePoint,
        suppliedWholeBoard?.candidate.color ?? toPlay,
        exactCandidateCaptures(candidate),
      )
    : verifiedCurrentStones
  const numberedPoints = suppliedWholeBoard?.steps.length
    ? suppliedWholeBoard.steps.slice(0, 8).map((move) => ({
        point: move.point,
        role: move.kind,
        coordinate: move.coordinate,
        order: move.order,
        evidence: move.evidence,
      }))
    : anchors.map((anchor, index) => ({
        point: anchor.point,
        role: anchor.role,
        coordinate: anchor.coordinate,
        order: index + 1,
        evidence: anchor.evidence,
      }))

  return (
    <svg viewBox="0 0 240 240" role="img" aria-label={label} className="opening-book-diagram whole-board-diagram">
      <title>{label}</title>
      <defs>
        <marker id={`mini-arrow-${candidate.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" className="mini-influence-arrowhead" />
        </marker>
      </defs>
      <rect x="2" y="2" width="236" height="236" rx="18" className="diagram-board" />
      {Array.from({ length: size }, (_, index) => (
        <g key={`grid-${index}`}>
          <line x1={margin + index * step} y1={margin} x2={margin + index * step} y2={margin + span} className="diagram-line mini" />
          <line x1={margin} y1={margin + index * step} x2={margin + span} y2={margin + index * step} className="diagram-line mini" />
        </g>
      ))}
      {teaching.territory.zones.map((zone, index) => {
        const center = at(zone.center)
        return <circle key={`zone-${index}`} cx={center.x} cy={center.y} r={Math.max(step * 1.2, step * zone.radius)} className={`mini-territory-zone ${zone.kind} ${zone.potential}`} />
      })}
      {teaching.influence.vectors.map((vector, index) => {
        const from = at(vector.from)
        const to = at(vector.to)
        return <line key={`vector-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="mini-influence-vector" markerEnd={`url(#mini-arrow-${candidate.id})`} />
      })}
      {verifiedStones.map((stone) => {
        const point = at(stone)
        const candidateStone = candidatePoint && samePoint(stone, suppliedWholeBoard?.candidate.point ?? candidatePoint)
        return <circle key={`stone-${pointKey(stone)}`} cx={point.x} cy={point.y} r={Math.max(3.2, step * 0.4)} className={`diagram-stone ${stone.color} ${candidateStone ? 'preview' : ''}`} data-point={pointKey(stone)} data-stone-state={candidateStone ? 'candidate-preview' : 'verified-after'} />
      })}
      {numberedPoints.map((item) => {
        const point = at(item.point)
        return (
          <g key={`${item.role}-${item.coordinate}-${item.order}`} className={`mini-anchor ${item.role}`} data-role={item.role} data-evidence={item.evidence} role="img" aria-label={anchorLabel(item)}>
            <circle cx={point.x} cy={point.y} r={Math.max(5.5, step * 0.52)} />
            <text x={point.x} y={point.y + 3} textAnchor="middle">{item.order}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function TeachingLineDiagram({
  diagram,
  candidateId,
  label,
  stepLabel,
  exactCaptures,
}: {
  diagram: OpeningTeachingDiagram
  candidateId: string
  label: string
  stepLabel: (step: OpeningTeachingDiagram['steps'][number]) => string
  exactCaptures: ReadonlyArray<Point>
}) {
  const { crop } = diagram
  const margin = 18
  const span = 184
  const columns = Math.max(1, crop.max_x - crop.min_x)
  const rows = Math.max(1, crop.max_y - crop.min_y)
  const xStep = span / columns
  const yStep = span / rows
  const xAt = (point: Point) => margin + (point.x - crop.min_x) * xStep
  const yAt = (point: Point) => margin + (point.y - crop.min_y) * yStep
  const markerId = `teaching-line-${candidateId}-${diagram.diagram_type}`
  const verifiedAfter = verifiedAfterStones(
    diagram.verified_current_stones.map((stone) => ({ ...stone.point, color: stone.color })),
    diagram.candidate.point,
    diagram.candidate.color,
    exactCaptures,
  )

  return (
    <svg
      viewBox="0 0 220 220"
      role="img"
      aria-label={label}
      className={`opening-book-diagram teaching-line-diagram ${diagram.diagram_type}`}
      data-testid="opening-authored-context-diagram"
      data-diagram-type={diagram.diagram_type}
      data-line-kind={diagram.line_kind}
      data-not-forced={diagram.not_forced}
      data-board-state="verified-after-candidate-preview"
      data-overlay-state="authored-context-not-forced"
    >
      <title>{label}</title>
      <defs>
        <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" className="teaching-line-arrowhead" />
        </marker>
      </defs>
      <rect x="2" y="2" width="216" height="216" rx="18" className="diagram-board" />
      {Array.from({ length: crop.max_x - crop.min_x + 1 }, (_, index) => crop.min_x + index).map((x) => (
        <line key={`x-${x}`} x1={xAt({ x, y: crop.min_y })} y1={margin} x2={xAt({ x, y: crop.min_y })} y2={margin + span} className="diagram-line" />
      ))}
      {Array.from({ length: crop.max_y - crop.min_y + 1 }, (_, index) => crop.min_y + index).map((y) => (
        <line key={`y-${y}`} x1={margin} y1={yAt({ x: crop.min_x, y })} x2={margin + span} y2={yAt({ x: crop.min_x, y })} className="diagram-line" />
      ))}
      {diagram.steps.map((step) => (
        <line
          key={`line-${step.order}-${pointKey(step.point)}`}
          x1={xAt(diagram.candidate.point)}
          y1={yAt(diagram.candidate.point)}
          x2={xAt(step.point)}
          y2={yAt(step.point)}
          className={`teaching-context-line ${step.kind}`}
          markerEnd={`url(#${markerId})`}
        />
      ))}
      {verifiedAfter.map((stone) => {
        const candidateStone = samePoint(stone, diagram.candidate.point)
        return (
        <circle
          key={`stone-${pointKey(stone)}-${stone.color}`}
          cx={xAt(stone)}
          cy={yAt(stone)}
          r={Math.min(xStep, yStep) * 0.4}
          className={`diagram-stone ${stone.color} ${candidateStone ? 'preview' : ''}`}
          data-point={pointKey(stone)}
          data-stone-state={candidateStone ? 'candidate-preview' : 'verified-after'}
        />
        )
      })}
      {diagram.steps.map((step) => (
        <g
          key={`step-${step.order}-${pointKey(step.point)}`}
          className={`teaching-step-anchor ${step.kind}`}
          role="img"
          aria-label={stepLabel(step)}
          data-evidence={step.evidence}
        >
          <circle cx={xAt(step.point)} cy={yAt(step.point)} r={Math.max(8, Math.min(xStep, yStep) * 0.46)} />
          <text x={xAt(step.point)} y={yAt(step.point) + 3.5} textAnchor="middle">{step.order}</text>
        </g>
      ))}
    </svg>
  )
}

export function OpeningEvidenceCards({
  summaries,
  thickness,
  weaknesses,
  territoryNote,
  balanceEffect,
  josekiNote,
}: {
  summaries: { shape: string; territory: string; influence: string; joseki: string }
  thickness: string
  weaknesses: string[]
  territoryNote: string
  balanceEffect: string
  josekiNote: string
}) {
  const { t } = useI18n()
  return (
    <div className="opening-evidence-cards">
      <article className="shape" data-testid="opening-shape-exact-card" data-evidence="exact"><strong>{t('opening.shape')}</strong><em>{t('opening.exact')}</em><p>{summaries.shape}</p></article>
      {(thickness || weaknesses.length > 0) && <article className="shape-assessment" data-testid="opening-shape-assessment" data-evidence="calculated_potential"><strong>{t('opening.beforeAfter')}</strong><em>{t('opening.calculated')}</em><p>{[thickness, ...weaknesses].filter(Boolean).join(' · ')}</p></article>}
      <article className="territory" data-evidence="calculated_potential"><strong>{t('opening.territory')}</strong><em>{t('opening.calculated')}</em><p>{summaries.territory}</p><small>{territoryNote}</small></article>
      <article className="influence" data-evidence="calculated_potential"><strong>{t('opening.influence')}</strong><em>{t('opening.calculated')}</em><p>{summaries.influence}</p><small>{balanceEffect}</small></article>
      <article className="joseki" data-evidence="authored"><strong>{t('opening.joseki')}</strong><em>{t('opening.authored')}</em><p>{summaries.joseki}</p><small>{josekiNote}</small></article>
    </div>
  )
}

export function OpeningEngineProvenanceCard({ engine }: { engine?: OpeningEngineProvenance }) {
  const { t } = useI18n()
  const candidateAnalyzed = engine?.available === true && engine.candidate_analyzed === true
  const unavailableText = localizedCopy(
    engine?.available === false ? engine.reason_id : 'engine_evidence_not_attached',
    t,
    t('candidate.noEngine'),
  )
  return (
    <span
      data-testid="opening-engine-provenance"
      data-source="KataGo"
      data-engine-available={engine?.available === true}
      data-candidate-analyzed={candidateAnalyzed}
      data-profile={engine?.available === true ? engine.profile : undefined}
      data-requested-visits={engine?.available === true ? engine.requested_visits : undefined}
      data-actual-visits={engine?.available === true ? engine.actual_visits : undefined}
      data-model-sha256={engine?.available === true ? engine.model_sha256 : undefined}
    >
      <b>{t('source.engine')}</b>
      <em>{candidateAnalyzed ? t('evidence.engine') : t('candidate.noEngine')}</em>
      <small>{candidateAnalyzed ? t('candidate.supportsComparison') : unavailableText}</small>
    </span>
  )
}

export function OpeningReading({ size, stones, toPlay, candidate, teaching, onDeepStudy, deepStudyBusy = false }: OpeningReadingProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()
  const deepStudyDescriptionId = useId()
  const summaries = useMemo(() => displaySummaries(teaching, t), [teaching, t])
  const anchors = useMemo(() => [...teaching.follow_ups, ...teaching.reply_anchors], [teaching])
  const coordinate = candidate.coordinate
  const purpose = localizedCopy(teaching.purpose_id, t, t('opening.summary'))
  const why = localizedCopy(teaching.why_id, t, t('opening.summary'))
  const gains = teaching.gain_ids.map((id) => localizedCopy(id, t, '')).filter(Boolean)
  const losses = teaching.loss_ids.map((id) => localizedCopy(id, t, '')).filter(Boolean)
  const mechanismFacts = teaching.mechanism.fact_ids.map((id) => localizedCopy(id, t, '', {
    count: teaching.mechanism.exact.resulting_liberties,
  })).filter(Boolean)
  const beforeShape = localizedCopy(teaching.mechanism.before_shape_id, t, t('opening.nothingPlaced'))
  const afterShape = localizedCopy(teaching.mechanism.after_shape_id, t, summaries.influence)
  const reconsiderConditions = teaching.mechanism.reconsider_condition_ids
    .map((id) => localizedCopy(id, t, ''))
    .filter(Boolean)
  const balanceEffect = localizedCopy(teaching.whole_board.balance_effect_id, t, summaries.influence)
  const territoryNote = localizedCopy(teaching.territory.note_id, t, t('opening.territoryHelp'))
  const josekiNote = localizedCopy(teaching.joseki.note_id, t, summaries.joseki)
  const initiative = localizedCopy(teaching.initiative.sente_status_id, t, t('opening.illustrativeLine'))
  const shapeAssessment = teaching.mechanism.shape_assessment?.evidence === 'calculated_potential'
    ? teaching.mechanism.shape_assessment
    : undefined
  const thickness = localizedCopy(shapeAssessment?.thickness_id, t, '')
  const weaknesses = (shapeAssessment?.weakness_ids ?? [])
    .map((id) => localizedCopy(id, t, ''))
    .filter(Boolean)
  const cautions = teaching.caution_ids.map((id) => localizedCopy(id, t, '')).filter(Boolean)
  const limitations = teaching.limitations_ids.map((id) => localizedCopy(id, t, '')).filter(Boolean)
  const lineDiagrams = teaching.teaching_diagrams.filter((diagram) =>
    diagram.diagram_type === 'corner_sequence' || diagram.diagram_type === 'reply_branch',
  )

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = priorOverflow
      previous?.focus()
    }
  }, [open])

  const accessibleSummary = t('opening.compareAria', {
    coordinate,
    shape: summaries.shape,
    territory: summaries.territory,
    influence: summaries.influence,
    joseki: summaries.joseki,
  })
  const shapeBeforeLabel = t('opening.beforeDiagram', { coordinate })
  const shapeAfterLabel = t('opening.afterDiagram', { coordinate })
  const wholeBoardLabel = t('opening.wholeDiagramAria', { coordinate })

  const modal = open && typeof document !== 'undefined' ? createPortal(
    <div
      className="opening-dialog-backdrop"
      data-testid="opening-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        ref={dialogRef}
        className="opening-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        data-testid="opening-dialog"
        data-candidate-id={candidate.id}
      >
        <header className="opening-dialog-header">
          <div>
            <span className="eyebrow">{t('opening.title')}</span>
            <h2 id={dialogTitleId}>{t('opening.dialogTitle', { coordinate })}</h2>
            <p id={dialogDescriptionId}>{t('opening.modalNothingPlaced')}</p>
          </div>
          <button ref={closeRef} type="button" className="opening-dialog-close" onClick={() => setOpen(false)} aria-label={t('opening.closeDetails')} data-testid="opening-dialog-close">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="opening-dialog-scroll">
          <p className="opening-dialog-keyboard sr-only">{t('opening.keyboardHelp')}</p>

          <section className="opening-book-section why" data-testid="opening-why-section">
            <div className="opening-section-heading"><Sparkles size={19} aria-hidden="true" /><div><span>{t('opening.whyThisMove')}</span><h3>{purpose}</h3></div></div>
            <p>{why}</p>
            <div className="opening-why-grid">
              <article className="gain"><strong>{t('opening.gain')}</strong><p>{gains.length ? gains.join(' · ') : summaries.territory}</p></article>
              <article className="tradeoff"><strong>{t('opening.tradeoff')}</strong><p>{losses.length ? losses.join(' · ') : t('opening.territoryHelp')}</p></article>
              <article className="future"><strong>{t('opening.buildsToward')}</strong><p>{afterShape}</p></article>
            </div>
          </section>

          <section className="opening-book-section diagrams" data-testid="opening-diagrams">
            <div className="opening-section-heading"><BookOpen size={19} aria-hidden="true" /><div><span>{t('opening.beforeAfter')}</span><h3>{t('opening.localDiagram')}</h3></div></div>
            <div className="opening-local-comparison">
              <figure>
                <LocalShapeDiagram size={size} stones={stones} toPlay={toPlay} candidate={candidate} after={false} label={shapeBeforeLabel} />
                <figcaption><b>{t('opening.before')}</b><span>{beforeShape}</span></figcaption>
              </figure>
              <ArrowRight className="opening-comparison-arrow" aria-hidden="true" />
              <figure>
                <LocalShapeDiagram size={size} stones={stones} toPlay={toPlay} candidate={candidate} after label={shapeAfterLabel} />
                <figcaption><b>{t('opening.after')}</b><span>{summaries.shape}</span></figcaption>
              </figure>
            </div>
          </section>

          <section className="opening-book-section whole" data-testid="opening-whole-board-section">
            <div className="opening-section-heading"><Map size={19} aria-hidden="true" /><div><span>{t('opening.influence')} + {t('opening.territory')}</span><h3>{t('opening.wholeBoardDiagram')}</h3></div></div>
            <div className="opening-whole-layout">
              <figure>
                <WholeBoardDiagram
                  size={size}
                  stones={stones}
                  toPlay={toPlay}
                  candidate={candidate}
                  teaching={teaching}
                  label={wholeBoardLabel}
                  anchorLabel={(item) => t('opening.anchorAria', {
                    number: item.order,
                    role: t(ANCHOR_KEYS[(item.role in ANCHOR_KEYS ? item.role : 'direction') as keyof typeof ANCHOR_KEYS]),
                    coordinate: item.coordinate,
                  })}
                />
                <figcaption>{wholeBoardLabel}</figcaption>
              </figure>
              <OpeningEvidenceCards summaries={summaries} thickness={thickness} weaknesses={weaknesses} territoryNote={territoryNote} balanceEffect={balanceEffect} josekiNote={josekiNote} />
            </div>
          </section>

          <section className="opening-book-section sequence" data-testid="opening-sequence-section">
            <div className="opening-section-heading"><GitBranch size={19} aria-hidden="true" /><div><span>{t('opening.sequence')}</span><h3>{t('opening.followUps')}</h3></div></div>
            <ol className="opening-sequence-list">
              {anchors.map((anchor, index) => (
                <li key={`${anchor.role}-${anchor.coordinate}-${index}`} data-role={anchor.role}>
                  <i aria-hidden="true">{index + 1}</i>
                  <div>
                    <strong>{localizedCopy(anchor.label_id, t, t(ANCHOR_KEYS[anchor.role]))} · {anchor.coordinate}</strong>
                    <p>{localizedCopy(anchor.reason_id, t, anchor.role === 'reply' || anchor.role === 'approach' ? t('opening.opponentReply') : t('opening.nextWhy'))}</p>
                    {anchor.timing_id && <small>{localizedCopy(anchor.timing_id, t, '')}</small>}
                  </div>
                </li>
              ))}
            </ol>
            <p className="opening-sequence-disclaimer">{t('opening.sequenceDisclaimer')}</p>
            <p className="opening-initiative"><b>{t('opening.reconsider')}</b> {initiative}</p>
          </section>

          {lineDiagrams.length > 0 && (
            <section className="opening-book-section textbook" data-testid="opening-textbook-diagrams">
              <div className="opening-section-heading"><BookOpen size={19} aria-hidden="true" /><div><span>{t('opening.illustrativeLine')}</span><h3>{t('opening.cornerSequence')}</h3></div></div>
              <div className="opening-textbook-grid">
                {lineDiagrams.map((diagram) => {
                  const title = diagram.diagram_type === 'reply_branch' ? t('opening.responseBranch') : t('opening.cornerSequence')
                  return (
                    <figure key={diagram.diagram_type} data-diagram-type={diagram.diagram_type} data-not-forced={diagram.not_forced}>
                      <TeachingLineDiagram
                        diagram={diagram}
                        candidateId={candidate.id}
                        label={`${title}. ${t('opening.illustrativeLine')}. ${t('opening.candidateStone')}.`}
                        exactCaptures={exactCandidateCaptures(candidate)}
                        stepLabel={(step) => t('opening.anchorAria', {
                          number: step.order,
                          role: localizedCopy(step.label_id, t, t(ANCHOR_KEYS[step.kind])),
                          coordinate: step.coordinate,
                        })}
                      />
                      <figcaption>
                        <span><b>{title}</b><em>{t('opening.illustrativeLine')}</em></span>
                        <ol>
                          {diagram.steps.map((step) => (
                            <li key={`${diagram.diagram_type}-${step.order}-${step.coordinate}`}>
                              <i aria-hidden="true">{step.order}</i>
                              <div>
                                <strong>{localizedCopy(step.label_id, t, t(ANCHOR_KEYS[step.kind]))} · {step.coordinate}</strong>
                                <p>{localizedCopy(step.why_id, t, t('opening.nextWhy'))}</p>
                                <small><b>{t('opening.gain')}</b> {localizedCopy(step.gain_id, t, t('opening.territoryHelp'))}</small>
                                <small><b>{t('opening.tradeoff')}</b> {localizedCopy(step.loss_id, t, t('opening.territoryHelp'))}</small>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            </section>
          )}

          <section className="opening-book-section decision" data-testid="opening-decision-section">
            <div className="opening-section-heading"><ShieldCheck size={19} aria-hidden="true" /><div><span>{t('opening.reconsider')}</span><h3>{t('opening.nextWhy')}</h3></div></div>
            <div className="opening-decision-grid">
              <article><strong>{t('opening.mechanism')}</strong><p>{mechanismFacts.length ? mechanismFacts.join(' · ') : t('opening.shapeHelp')}</p></article>
              <article><strong>{t('opening.beforeAfter')}</strong><p><b>{t('opening.before')}</b> {beforeShape}<br /><b>{t('opening.after')}</b> {afterShape}</p></article>
              <article><strong>{t('opening.reconsider')}</strong><p>{reconsiderConditions.length ? reconsiderConditions.join(' · ') : initiative}</p></article>
            </div>
            {(cautions.length > 0 || limitations.length > 0) && (
              <p className="opening-limitations">{[...cautions, ...limitations].join(' · ')}</p>
            )}
          </section>

          <section className="opening-book-section provenance" data-testid="opening-provenance-section">
            <div className="opening-section-heading"><ShieldCheck size={19} aria-hidden="true" /><div><span>{t('opening.mechanism')}</span><h3>{t('opening.provenance')}</h3></div></div>
            <div className="opening-provenance-grid">
              <span data-source={teaching.provenance.rules_facts.source}><b>{t('opening.shape')}</b><em>{t('opening.exact')}</em><small>{t('opening.shapeHelp')}</small></span>
              <span data-source={teaching.provenance.geometry.source}><b>{t('opening.territory')}</b><em>{t('opening.calculated')}</em><small>{t('opening.territoryHelp')}</small></span>
              <span data-source={teaching.provenance.geometry.source}><b>{t('opening.influence')}</b><em>{t('opening.calculated')}</em><small>{t('opening.influenceHelp')}</small></span>
              <span data-source={teaching.provenance.strategy.source}><b>{t('opening.joseki')}</b><em>{t('opening.authored')}</em><small>{t('opening.josekiHelp')}</small></span>
              <OpeningEngineProvenanceCard engine={teaching.provenance.engine} />
            </div>
          </section>

          {onDeepStudy && (
            <section className="opening-deep-study" data-testid="opening-deep-study">
              <div>
                <strong>{t('opening.deepStudy')}</strong>
                <p id={deepStudyDescriptionId}>{t('opening.deepStudyHelp')}</p>
              </div>
              <button
                type="button"
                onClick={() => requestOpeningDeepStudy(onDeepStudy, () => setOpen(false))}
                disabled={deepStudyBusy}
                aria-busy={deepStudyBusy}
                aria-describedby={deepStudyDescriptionId}
                data-testid="opening-deep-study-button"
              >
                <BrainCircuit size={18} aria-hidden="true" />
                {deepStudyBusy ? t('opening.deepStudyBusy') : t('opening.deepStudy')}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <section className="opening-reading" data-testid="opening-reading" data-candidate-id={teaching.binding.candidate_id} data-evidence-lanes="exact calculated_potential authored" aria-label={t('opening.layerAria', { coordinate })}>
      <header className="opening-reading-title">
        <div><strong>{t('opening.title')}</strong><span>{coordinate}</span></div>
        <small>{t('opening.nothingPlaced')}</small>
      </header>
      <p className="sr-only" data-testid="opening-reading-accessible">{accessibleSummary}</p>
      <div className="opening-reading-grid">
        <article data-testid="opening-reading-shape" data-evidence="exact"><span className="opening-reading-icon shape" aria-hidden="true" /><div><strong>{t('opening.shape')}</strong><p>{summaries.shape}</p></div><em>{t('opening.exact')}</em></article>
        <article data-testid="opening-reading-territory" data-evidence="calculated_potential"><span className="opening-reading-icon territory" aria-hidden="true" /><div><strong>{t('opening.territory')}</strong><p>{summaries.territory}</p></div><em>{t('opening.calculated')}</em></article>
        <article data-testid="opening-reading-influence" data-evidence="calculated_potential"><span className="opening-reading-icon influence" aria-hidden="true" /><div><strong>{t('opening.influence')}</strong><p>{summaries.influence}</p></div><em>{t('opening.calculated')}</em></article>
        <article data-testid="opening-reading-joseki" data-evidence="authored"><span className="opening-reading-icon joseki" aria-hidden="true">定</span><div><strong>{t('opening.joseki')}</strong><p>{summaries.joseki}</p></div><em>{t('opening.authored')}</em></article>
      </div>
      <div className="opening-reading-action">
        <div><strong>{t('opening.whyThisMove')}</strong><span>{why}</span></div>
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)} data-testid="opening-details-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={t('opening.openDetails')}>
          {t('opening.whyThisMove')} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      {modal}
    </section>
  )
}
