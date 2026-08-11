import { useEffect, useId, useMemo, useState } from 'react'
import {
  allGroups,
  clampBoardFocus,
  orthogonalNeighbors,
  ownershipClass,
  ownershipMap,
  pointKey,
  pointToCoordinate,
  samePoint,
  strongOwnershipForecast,
  stoneMap,
  teachingPresenceField,
} from '../board'
import { localizeRulesReason, useI18n, type Locale } from '../i18n'
import type { BoardSize, CandidateMove, MovePreview, MoveRecord, OwnershipCell, Point, Stone, StoneColor } from '../types'

export type EnergyLensId = 'cloud' | 'breath' | 'bonds' | 'shelter' | 'reach' | 'ground' | 'area' | 'beat' | 'pressure'
export type CandidatePreviewMode = 'suggested-first-stone' | 'if-played' | 'candidate-comparison' | 'pinned-candidate'

interface WeiqiBoardProps {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  selected: Point | null
  onSelect: (point: Point) => void
  selectionClearable?: boolean
  onClearSelection?: () => void
  preview?: MovePreview | null
  candidatePreview?: CandidateMove | null
  candidatePreviewMode?: CandidatePreviewMode | null
  lastMove?: MoveRecord | null
  ownership?: OwnershipCell[]
  activeLenses: Set<EnergyLensId>
  showCoordinates: boolean
  disabled?: boolean
  reducedMotion?: boolean
  operationStatus?: string
}

const BOARD_EDGE = 540
const PADDING = 48
const GRID_SPAN = BOARD_EDGE - PADDING * 2

function authored(locale: Locale, english: string, chinese: string, japanese: string): string {
  return locale === 'zh-Hans' ? chinese : locale === 'ja' ? japanese : english
}

function starPoints(size: BoardSize): Point[] {
  if (size === 9) {
    return [
      { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 4, y: 4 },
      { x: 2, y: 6 }, { x: 6, y: 6 },
    ]
  }
  if (size === 7) return [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 4 }, { x: 4, y: 4 }]
  return [{ x: 2, y: 2 }]
}

export function WeiqiBoard({
  size,
  stones,
  toPlay,
  selected,
  onSelect,
  selectionClearable = false,
  onClearSelection,
  preview,
  candidatePreview,
  candidatePreviewMode,
  lastMove,
  ownership,
  activeLenses,
  showCoordinates,
  disabled = false,
  reducedMotion = false,
  operationStatus = 'idle',
}: WeiqiBoardProps) {
  const { locale, t } = useI18n()
  const instanceId = useId().replace(/:/g, '')
  const step = GRID_SPAN / (size - 1)
  const occupied = useMemo(() => stoneMap(stones), [stones])
  const groups = useMemo(() => allGroups(stones, size), [stones, size])
  const candidateEngineField = Boolean(
    candidatePreview?.engine_analyzed === true && size === 9 && (candidatePreview.ownership_after?.length || candidatePreview.ownership_delta?.length),
  )
  const candidateOwnership = candidateEngineField ? candidatePreview?.ownership_after : undefined
  const displayedOwnership = candidatePreview ? candidateOwnership : ownership
  const ownershipByPoint = useMemo(() => ownershipMap(displayedOwnership), [displayedOwnership])
  const candidateDelta = candidateEngineField ? candidatePreview?.ownership_delta ?? [] : []
  const candidateDeltaDisplayThreshold = useMemo(() => {
    const magnitudes = candidateDelta
      .map((cell) => Math.abs(cell.value))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)
    if (!magnitudes.length) return Number.POSITIVE_INFINITY
    const topChangeCutoff = magnitudes[Math.min(23, magnitudes.length - 1)]
    return Math.max(0.06, topChangeCutoff)
  }, [candidateDelta])
  const visibleCandidateDelta = useMemo(
    () => candidateDelta.filter((cell) => Math.abs(cell.value) >= candidateDeltaDisplayThreshold),
    [candidateDelta, candidateDeltaDisplayThreshold],
  )
  const candidatePoint = candidatePreview?.point ?? null
  const candidateIsPass = Boolean(candidatePreview && (candidatePreview.kind === 'pass' || candidatePreview.point == null))
  const candidateVariationAvailable = Boolean(
    candidatePreview?.ownership_after?.length &&
    candidatePreview.ownership_after.every((cell) => Number.isFinite(cell.variation ?? cell.uncertainty)),
  )
  // A pass candidate intentionally has no point. Do not let a stale selected
  // intersection reappear as its ghost stone.
  const displayPoint = candidatePreview ? candidatePoint : selected
  const legalSelectedPreview = Boolean(
    selected &&
      preview?.legal &&
      samePoint(selected, preview.point) &&
      !occupied.has(pointKey(selected)),
  )
  const candidateStone = Boolean(candidatePoint && !occupied.has(pointKey(candidatePoint)))
  const presenceField = useMemo(
    () => teachingPresenceField(stones, size),
    [size, stones],
  )
  const candidateCaptures = candidatePreview
    ? candidatePreview.tactics?.captures ?? (candidatePoint && preview && samePoint(preview.point, candidatePoint) ? preview.captures : [])
    : preview?.captures ?? []
  const candidateLiberties = candidatePreview
    ? candidatePreview.tactics?.resulting_liberties ?? (candidatePoint && preview && samePoint(preview.point, candidatePoint) ? preview.resulting_liberties : null)
    : preview?.resulting_liberties ?? null
  const candidateConnections = candidatePreview?.tactics?.connects ?? []
  const candidateCuts = candidatePreview?.tactics?.cuts ?? []
  const lastMovePoint = lastMove?.kind === 'play' ? lastMove.point ?? null : null
  const [focusAnchor, setFocusAnchor] = useState<Point>(() => selected ?? { x: 0, y: 0 })
  const points = useMemo(
    () => Array.from({ length: size * size }, (_, index) => ({ x: index % size, y: Math.floor(index / size) })),
    [size],
  )
  const position = (point: Point) => ({
    x: PADDING + point.x * step,
    y: PADDING + point.y * step,
  })
  const cloudVisible = activeLenses.has('cloud')
  const presenceSketchVisible = cloudVisible && !candidatePreview
  const openingCloud = presenceSketchVisible && stones.length === 0
  const baselineOwnershipVisible = Boolean(
    !candidatePreview && ownership?.length && (activeLenses.has('reach') || activeLenses.has('ground')),
  )
  const candidateOwnershipVisible = Boolean(candidateOwnership?.length)
  const engineLayerVisible = Boolean(
    baselineOwnershipVisible || candidateOwnershipVisible,
  )
  const openingInset = PADDING + step * (size === 5 ? 0.65 : size === 7 ? 0.9 : 1.15)
  const openingFar = BOARD_EDGE - openingInset
  const openingUnit = Math.min(step, 68)
  const cloudIds = {
    black: `black-presence-${instanceId}`,
    white: `white-presence-${instanceId}`,
    contested: `contested-presence-${instanceId}`,
    corner: `corner-potential-${instanceId}`,
    side: `side-potential-${instanceId}`,
    center: `center-potential-${instanceId}`,
    clip: `board-clip-${instanceId}`,
    smooth: `candidate-field-smooth-${instanceId}`,
  }

  useEffect(() => {
    if (selected) setFocusAnchor(clampBoardFocus(selected, size))
    else setFocusAnchor((current) => clampBoardFocus(current, size))
  }, [selected, size])

  const moveFocus = (current: Point, dx: number, dy: number, root: SVGSVGElement | null) => {
    const next = clampBoardFocus({ x: current.x + dx, y: current.y + dy }, size)
    setFocusAnchor(next)
    root?.querySelector<SVGElement>(`[data-point="${pointKey(next)}"]`)?.focus()
  }

  return (
    <div className="board-visual">
      <div
        className={`board-frame ${reducedMotion ? 'reduce-motion' : ''}`}
        data-testid="weiqi-board-frame"
        data-board-size={size}
        data-operation={operationStatus}
        data-candidate-mode={candidatePreviewMode ?? 'none'}
        data-selection-clearable={selectionClearable}
        data-context-action={selectionClearable ? 'clear-selection' : 'browser-default'}
        onContextMenu={(event) => {
          if (!selectionClearable || !onClearSelection) return
          event.preventDefault()
          onClearSelection()
        }}
      >
      <svg
        className="weiqi-board"
        viewBox={`0 0 ${BOARD_EDGE} ${BOARD_EDGE}`}
        role="grid"
        aria-label={t('board.grid', { size, color: toPlay === 'black' ? t('board.black') : t('board.white') })}
        aria-keyshortcuts={selectionClearable ? 'Escape' : undefined}
        data-testid="weiqi-board"
      >
        <title>{t('board.grid', { size, color: toPlay === 'black' ? t('board.black') : t('board.white') })}</title>
        <defs>
          <linearGradient id="board-wash" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f7dda5" />
            <stop offset="0.52" stopColor="#efc87e" />
            <stop offset="1" stopColor="#e8bc6f" />
          </linearGradient>
          <radialGradient id="black-stone" cx="35%" cy="28%" r="74%">
            <stop offset="0" stopColor="#4c6170" />
            <stop offset="0.34" stopColor="#1c2e3a" />
            <stop offset="1" stopColor="#08141d" />
          </radialGradient>
          <radialGradient id="white-stone" cx="35%" cy="28%" r="74%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.62" stopColor="#f7f4ea" />
            <stop offset="1" stopColor="#d6d5cd" />
          </radialGradient>
          <filter id="stone-shadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#4c3721" floodOpacity=".28" />
          </filter>
          <pattern id="mist-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#668ca0" opacity=".38" />
          </pattern>
          <radialGradient id={cloudIds.black}>
            <stop offset="0" stopColor="#006da8" stopOpacity=".92" />
            <stop offset=".46" stopColor="#00a6c2" stopOpacity=".62" />
            <stop offset="1" stopColor="#6ed8e2" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={cloudIds.white}>
            <stop offset="0" stopColor="#ef4d35" stopOpacity=".9" />
            <stop offset=".48" stopColor="#ff7b45" stopOpacity=".6" />
            <stop offset="1" stopColor="#ffbc82" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={cloudIds.contested}>
            <stop offset="0" stopColor="#6827c9" stopOpacity=".94" />
            <stop offset=".5" stopColor="#9a4be0" stopOpacity=".66" />
            <stop offset="1" stopColor="#d6a9f1" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={cloudIds.corner}>
            <stop offset="0" stopColor="#12a878" stopOpacity=".68" />
            <stop offset="1" stopColor="#73d6b6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={cloudIds.side}>
            <stop offset="0" stopColor="#dc554e" stopOpacity=".64" />
            <stop offset="1" stopColor="#f2a078" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={cloudIds.center}>
            <stop offset="0" stopColor="#7c45bd" stopOpacity=".58" />
            <stop offset="1" stopColor="#cbb8e8" stopOpacity="0" />
          </radialGradient>
          <clipPath id={cloudIds.clip}>
            <rect x="15" y="15" width="510" height="510" rx="22" />
          </clipPath>
          <filter id={cloudIds.smooth} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={Math.max(5, step * 0.1)} />
          </filter>
        </defs>

        <rect x="5" y="5" width="530" height="530" rx="28" fill="url(#board-wash)" />
        <rect x="15" y="15" width="510" height="510" rx="22" fill="none" stroke="#8f672e" strokeOpacity=".2" />

        {openingCloud && (
          <g
            className="opening-potential-cloud"
            data-testid="opening-potential-cloud"
            clipPath={`url(#${cloudIds.clip})`}
            aria-hidden="true"
          >
            {[
              { x: openingInset, y: openingInset },
              { x: openingFar, y: openingInset },
              { x: openingInset, y: openingFar },
              { x: openingFar, y: openingFar },
            ].map((center, index) => (
              <circle
                key={`opening-corner-${index}`}
                cx={center.x}
                cy={center.y}
                r={openingUnit * 1.5}
                fill={`url(#${cloudIds.corner})`}
                data-zone-kind="corner"
              />
            ))}
            {[
              { x: BOARD_EDGE / 2, y: openingInset, rx: openingUnit * 1.55, ry: openingUnit * 0.9 },
              { x: BOARD_EDGE / 2, y: openingFar, rx: openingUnit * 1.55, ry: openingUnit * 0.9 },
              { x: openingInset, y: BOARD_EDGE / 2, rx: openingUnit * 0.9, ry: openingUnit * 1.55 },
              { x: openingFar, y: BOARD_EDGE / 2, rx: openingUnit * 0.9, ry: openingUnit * 1.55 },
            ].map((center, index) => (
              <ellipse
                key={`opening-side-${index}`}
                cx={center.x}
                cy={center.y}
                rx={center.rx}
                ry={center.ry}
                fill={`url(#${cloudIds.side})`}
                data-zone-kind="side"
              />
            ))}
            <circle
              cx={BOARD_EDGE / 2}
              cy={BOARD_EDGE / 2}
              r={openingUnit * 1.55}
              fill={`url(#${cloudIds.center})`}
              data-zone-kind="center"
            />
          </g>
        )}

        {presenceSketchVisible && stones.length > 0 && (
          <g
            className="stone-presence-cloud"
            data-testid="stone-presence-cloud"
            data-decision-layer="false"
            clipPath={`url(#${cloudIds.clip})`}
            aria-hidden="true"
          >
            <g data-field="black">
              {stones.filter((stone) => stone.color === 'black').map((stone, index) => {
                const { x, y } = position(stone)
                return <circle key={`black-cloud-${pointKey(stone)}-${index}`} cx={x} cy={y} r={step * (size === 5 ? 2.05 : 2.45)} fill={`url(#${cloudIds.black})`} opacity=".72" />
              })}
            </g>
            <g data-field="white">
              {stones.filter((stone) => stone.color === 'white').map((stone, index) => {
                const { x, y } = position(stone)
                return <circle key={`white-cloud-${pointKey(stone)}-${index}`} cx={x} cy={y} r={step * (size === 5 ? 2.05 : 2.45)} fill={`url(#${cloudIds.white})`} opacity=".7" />
              })}
            </g>
            <g data-field="contested">
              {presenceField.filter((cell) => cell.contested >= 0.08).map((cell) => {
                const { x, y } = position(cell)
                return <circle key={`contested-cloud-${pointKey(cell)}`} cx={x} cy={y} r={step * 1.08} fill={`url(#${cloudIds.contested})`} opacity={0.28 + cell.contested * 0.58} />
              })}
            </g>
          </g>
        )}

        {(candidateOwnershipVisible || baselineOwnershipVisible) && (
          <g
            data-testid={candidateOwnershipVisible ? 'candidate-ownership-after' : 'current-ownership-field'}
            data-field-mode={candidateOwnershipVisible ? 'after-candidate' : 'current-position'}
            aria-hidden="true"
          >
            {points.map((point) => {
              const cell = ownershipByPoint.get(pointKey(point))
              if (!cell) return null
              const strongForecast = !candidateOwnershipVisible && strongOwnershipForecast(cell)
              if (!candidateOwnershipVisible) {
                if (activeLenses.has('ground') && !strongForecast && !activeLenses.has('reach')) return null
                if (!activeLenses.has('reach') && !strongForecast) return null
              }
              const kind = ownershipClass(cell)
              const { x, y } = position(point)
              const suppliedVariation = cell.variation ?? cell.uncertainty
              const continuationVariation = Number.isFinite(suppliedVariation) ? suppliedVariation as number : null
              const opacity = Math.min(0.36, 0.08 + Math.abs(cell.value) * 0.24) * Math.max(0.55, 1 - (continuationVariation ?? 0) * 0.6)
              const fill =
                kind === 'black' ? '#16394b' : kind === 'white' ? '#f9f7ea' : 'url(#mist-pattern)'
              return (
                <rect
                  key={`ownership-${pointKey(point)}`}
                  x={x - step * 0.43}
                  y={y - step * 0.43}
                  width={step * 0.86}
                  height={step * 0.86}
                  rx={step * 0.2}
                  fill={fill}
                  opacity={kind === 'mist' ? 0.44 : opacity}
                  className={strongForecast ? 'ownership-cell strong-forecast' : 'ownership-cell'}
                  data-continuation-variation={continuationVariation == null ? 'unknown' : continuationVariation.toFixed(3)}
                />
              )
            })}
          </g>
        )}

        {candidateOwnershipVisible && (
          <g
            className="candidate-ownership-smooth"
            data-testid="candidate-ownership-smooth"
            filter={`url(#${cloudIds.smooth})`}
            clipPath={`url(#${cloudIds.clip})`}
            aria-hidden="true"
          >
            {points.map((point) => {
              const cell = ownershipByPoint.get(pointKey(point))
              if (!cell) return null
              const { x, y } = position(point)
              const suppliedVariation = cell.variation ?? cell.uncertainty
              const continuationVariation = Number.isFinite(suppliedVariation) ? suppliedVariation as number : null
              const contested = continuationVariation == null || Math.abs(cell.value) < 0.18 || continuationVariation > 0.34
              const fill = continuationVariation == null
                ? '#69737d'
                : contested
                  ? '#8553c7'
                  : cell.value > 0 ? '#087fa6' : '#ee704c'
              return (
                <circle
                  key={`candidate-after-smooth-${pointKey(point)}`}
                  cx={x}
                  cy={y}
                  r={step * 0.62}
                  fill={fill}
                  opacity={0.08 + Math.min(0.34, Math.abs(cell.value) * 0.22 + (continuationVariation ?? 0) * 0.12)}
                />
              )
            })}
          </g>
        )}

        {candidateDelta.length > 0 && (
          <g
            className="candidate-ownership-delta"
            data-testid="candidate-ownership-delta"
            data-field-mode="change-vs-current"
            data-display-cutoff={Number.isFinite(candidateDeltaDisplayThreshold) ? candidateDeltaDisplayThreshold.toFixed(3) : 'none'}
            aria-hidden="true"
          >
            <g filter={`url(#${cloudIds.smooth})`} clipPath={`url(#${cloudIds.clip})`}>
              {visibleCandidateDelta.map((cell) => {
                const { x, y } = position(cell)
                const suppliedVariation = cell.variation ?? cell.uncertainty
                const continuationVariation = Number.isFinite(suppliedVariation) ? suppliedVariation as number : null
                const fill = continuationVariation == null
                  ? '#69737d'
                  : continuationVariation > 0.34
                    ? '#8553c7'
                    : cell.value > 0 ? '#087fa6' : '#ee704c'
                return (
                  <circle
                    key={`candidate-delta-smooth-${pointKey(cell)}`}
                    cx={x}
                    cy={y}
                    r={step * 0.7}
                    fill={fill}
                    opacity={0.1 + Math.min(0.58, Math.abs(cell.value) * 0.72)}
                  />
                )
              })}
            </g>
            {visibleCandidateDelta.map((cell) => {
              const { x, y } = position(cell)
              const magnitude = Math.min(1, Math.abs(cell.value))
              return (
                <rect
                  key={`candidate-delta-${pointKey(cell)}`}
                  x={x - step * 0.3}
                  y={y - step * 0.3}
                  width={step * 0.6}
                  height={step * 0.6}
                  rx={step * 0.22}
                  className={`candidate-delta-cell ${cell.value > 0 ? 'black' : 'white'}`}
                  opacity={0.18 + magnitude * 0.64}
                  data-value={cell.value.toFixed(3)}
                />
              )
            })}
          </g>
        )}

        {Array.from({ length: size }, (_, index) => {
          const offset = PADDING + index * step
          return (
            <g key={`line-${index}`} aria-hidden="true">
              <line x1={PADDING} y1={offset} x2={BOARD_EDGE - PADDING} y2={offset} className="board-line" />
              <line x1={offset} y1={PADDING} x2={offset} y2={BOARD_EDGE - PADDING} className="board-line" />
            </g>
          )
        })}

        {starPoints(size).map((point) => {
          const { x, y } = position(point)
          return <circle key={`star-${pointKey(point)}`} cx={x} cy={y} r={size === 9 ? 4.4 : 3.8} className="star-point" aria-hidden="true" />
        })}

        {showCoordinates &&
          Array.from({ length: size }, (_, index) => {
            const top = pointToCoordinate({ x: index, y: 0 }, size).replace(/\d+/, '')
            const row = String(size - index)
            const offset = PADDING + index * step
            return (
              <g key={`coordinate-${index}`} className="board-coordinate" aria-hidden="true">
                <text x={offset} y="27" textAnchor="middle">{top}</text>
                <text x="25" y={offset + 4} textAnchor="middle">{row}</text>
              </g>
            )
          })}

        {activeLenses.has('bonds') &&
          stones.flatMap((stone) =>
            orthogonalNeighbors(stone, size)
              .filter((neighbor) => {
                const other = occupied.get(pointKey(neighbor))
                return other?.color === stone.color && pointKey(stone) < pointKey(neighbor)
              })
              .map((neighbor) => {
                const from = position(stone)
                const to = position(neighbor)
                return (
                  <line
                    key={`bond-${pointKey(stone)}-${pointKey(neighbor)}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={`bond-line ${stone.color}`}
                    aria-hidden="true"
                  />
                )
              }),
          )}

        {activeLenses.has('breath') &&
          groups.flatMap((group, groupIndex) =>
            group.liberties.map((liberty) => {
              const { x, y } = position(liberty)
              return (
                <g key={`liberty-${groupIndex}-${pointKey(liberty)}`} aria-hidden="true">
                  <circle cx={x} cy={y} r="8" className={`liberty-marker ${group.color}`} />
                  <text x={x} y={y + 3.4} textAnchor="middle" className="liberty-dot">{group.liberties.length}</text>
                </g>
              )
            }),
          )}

        {candidatePoint && (candidateConnections.length > 0 || candidateCuts.length > 0) && (
          <g className="candidate-tactical-links" data-testid="candidate-tactical-links" aria-hidden="true">
            {candidateConnections.map((anchor) => {
              const from = position(candidatePoint)
              const to = position(anchor)
              return (
                <line
                  key={`candidate-connect-${pointKey(anchor)}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="candidate-connection-line"
                  data-kind="exact-connection"
                />
              )
            })}
            {candidateCuts.map((anchor) => {
              const from = position(candidatePoint)
              const to = position(anchor)
              return (
                <line
                  key={`candidate-cut-${pointKey(anchor)}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="candidate-cut-line"
                  data-kind="exact-cut-anchor"
                />
              )
            })}
          </g>
        )}

        {stones.map((stone) => {
          const { x, y } = position(stone)
          const isLast = samePoint(stone, lastMovePoint)
          return (
            <g key={`stone-${pointKey(stone)}`} className={`stone ${stone.color}`} aria-hidden="true">
              <circle
                cx={x}
                cy={y}
                r={step * 0.43}
                fill={stone.color === 'black' ? 'url(#black-stone)' : 'url(#white-stone)'}
                stroke={stone.color === 'black' ? '#07131b' : '#b8b7af'}
                strokeWidth="1.4"
                filter="url(#stone-shadow)"
              />
              {isLast && <circle cx={x} cy={y} r="4.2" className={`last-move ${stone.color}`} />}
            </g>
          )
        })}

        {displayPoint && !occupied.has(pointKey(displayPoint)) && (() => {
          const { x, y } = position(displayPoint)
          return (
            <g
              className={`selected-stone ${toPlay} ${candidateStone ? 'candidate-inspection-stone' : ''} ${candidatePreviewMode === 'suggested-first-stone' ? 'opening-suggestion-stone' : ''}`}
              data-testid={candidateStone ? 'candidate-ghost-stone' : undefined}
              data-preview-kind={candidatePreviewMode ?? (candidateStone ? 'candidate-inspection' : legalSelectedPreview ? 'rules-preview' : 'pending-selection')}
              aria-hidden="true"
            >
              <circle cx={x} cy={y} r={step * 0.43} className="selected-ghost" />
              <circle cx={x} cy={y} r={step * 0.51} className="selected-ring" />
              {candidateLiberties != null && (
                <g className="candidate-liberty-count" transform={`translate(${step * 0.32} ${-step * 0.34})`}>
                  <circle cx={x} cy={y} r={step * 0.15} />
                  <text x={x} y={y + 3.2} textAnchor="middle">{authored(locale, `L${candidateLiberties}`, `气${candidateLiberties}`, `ダ${candidateLiberties}`)}</text>
                </g>
              )}
            </g>
          )
        })()}

        {candidatePreviewMode === 'suggested-first-stone' && candidatePoint && (() => {
          const at = position(candidatePoint)
          const labelWidth = 138
          const labelX = Math.max(18, Math.min(BOARD_EDGE - labelWidth - 18, at.x - labelWidth / 2))
          const labelY = at.y < 105 ? at.y + step * 0.58 : at.y - step * 0.86
          return (
            <g
              className="opening-suggestion-callout"
              data-testid="suggested-first-stone"
              data-coordinate={candidatePreview?.coordinate}
              aria-hidden="true"
            >
              <circle cx={at.x} cy={at.y} r={step * 0.62} className="opening-suggestion-pulse" />
              <rect x={labelX} y={labelY} width={labelWidth} height="28" rx="14" />
              <text x={labelX + labelWidth / 2} y={labelY + 18} textAnchor="middle">{authored(locale, `Suggested first: ${candidatePreview?.coordinate}`, `建议第一手：${candidatePreview?.coordinate}`, `第一候補：${candidatePreview?.coordinate}`)}</text>
            </g>
          )
        })()}

        {candidateCaptures.map((captured) => {
          const { x, y } = position(captured)
          return <path key={`capture-${pointKey(captured)}`} d={`M ${x - 8} ${y - 8} L ${x + 8} ${y + 8} M ${x + 8} ${y - 8} L ${x - 8} ${y + 8}`} className="capture-mark" aria-hidden="true" />
        })}

        {candidatePreview?.variation?.length ? (
          <g className="candidate-pv" data-testid="candidate-pv" data-line-kind="engine-main-line-not-forced" aria-hidden="true">
            {candidatePreview.variation.slice(0, 4).map((move, index, line) => {
              if (!move.point) return null
              const at = position(move.point)
              const next = line.slice(index + 1).find((item) => item.point)
              const nextAt = next?.point ? position(next.point) : null
              return (
                <g key={`candidate-pv-${index}-${pointKey(move.point)}`}>
                  {nextAt && <line x1={at.x} y1={at.y} x2={nextAt.x} y2={nextAt.y} className="candidate-pv-path" />}
                  <circle cx={at.x} cy={at.y} r={step * 0.23} className={`candidate-pv-stone ${move.color}`} />
                  <text x={at.x} y={at.y + 4} textAnchor="middle" className={`candidate-pv-number ${move.color}`}>{index + 1}</text>
                </g>
              )
            })}
          </g>
        ) : null}

        {Array.from({ length: size }, (_, yIndex) => (
          <g key={`hit-row-${yIndex}`} role="row" aria-rowindex={yIndex + 1}>
            {Array.from({ length: size }, (_, xIndex) => {
              const point = { x: xIndex, y: yIndex }
              const { x, y } = position(point)
              const stone = occupied.get(pointKey(point))
              const coordinate = pointToCoordinate(point, size)
              const selectedHere = samePoint(point, selected)
              const label = stone
                ? t('board.stone', { coordinate, color: locale === 'en' ? stone.color : stone.color === 'black' ? t('board.black') : t('board.white'), last: samePoint(stone, lastMovePoint) ? t('board.lastMove') : '' })
                : t('board.empty', { coordinate, selected: selectedHere ? t('board.selected') : '' })
              return (
                <circle
                  key={`hit-${pointKey(point)}`}
                  cx={x}
                  cy={y}
                  r={Math.max(20, step * 0.47)}
                  fill="transparent"
                  className="board-hit"
                  data-point={pointKey(point)}
                  data-coordinate={coordinate}
                  data-occupied={stone ? stone.color : 'empty'}
                  role="gridcell"
                  aria-rowindex={yIndex + 1}
                  aria-colindex={xIndex + 1}
                  aria-label={label}
                  aria-selected={selectedHere}
                  aria-disabled={disabled || Boolean(stone)}
                  tabIndex={samePoint(point, focusAnchor) ? 0 : -1}
                  onFocus={() => setFocusAnchor(point)}
                  onClick={() => {
                    setFocusAnchor(point)
                    if (!disabled && !stone) onSelect(point)
                  }}
                  onKeyDown={(event) => {
                    const movement: Record<string, [number, number]> = {
                      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
                    }
                    const delta = movement[event.key]
                    if (delta) {
                      event.preventDefault()
                      moveFocus(point, delta[0], delta[1], event.currentTarget.ownerSVGElement)
                      return
                    }
                    if ((event.key === 'Enter' || event.key === ' ') && !disabled && !stone) {
                      event.preventDefault()
                      onSelect(point)
                    }
                  }}
                />
              )
            })}
          </g>
        ))}
      </svg>
      <div className="board-live-status sr-only" aria-live="polite">
        {candidatePreview
          ? candidatePreviewMode === 'suggested-first-stone'
            ? authored(locale, `Suggested first stone: ${candidatePreview.coordinate}. Nothing has been placed. Click this point or any legal empty intersection to analyze what would happen before deciding.`, `建议的第一手：${candidatePreview.coordinate}。尚未落子。单击此点或任何合法空点，在决定前分析后果。`, `おすすめの第一手：${candidatePreview.coordinate}。まだ石は打たれていません。この点または合法な空交点を選び、決定前に結果を分析します。`)
            : candidatePreviewMode === 'if-played'
              ? authored(locale, `If ${toPlay} played ${candidatePreview.coordinate}, this non-committing analysis would apply. No stone has been placed.`, `如果${toPlay === 'black' ? '黑棋' : '白棋'}下在 ${candidatePreview.coordinate}，将应用这份不落子分析。尚未落子。`, `${toPlay === 'black' ? '黒' : '白'}が ${candidatePreview.coordinate} に打った場合の未着手分析です。石はまだ打たれていません。`)
              : candidateEngineField
            ? authored(locale, `Inspecting ${candidatePreview.coordinate}, ${candidatePreview.title}. This is a non-committing engine candidate forecast.`, `正在查看 ${candidatePreview.coordinate}，${candidatePreview.title}。这是不落子的引擎候选预测。`, `${candidatePreview.coordinate}（${candidatePreview.title}）を確認中です。着手しないエンジン候補予測です。`)
            : candidateIsPass
              ? authored(locale, `Inspecting pass, ${candidatePreview.title}. This is a non-committing pass preview; no stone is placed and no engine ownership map is supplied.`, `正在查看停一手，${candidatePreview.title}。这是不落子的停一手预览；不放置棋子，也未提供引擎归属图。`, `パス（${candidatePreview.title}）を確認中です。着手しないパスプレビューで、石もエンジン帰属図もありません。`)
              : authored(locale, `Inspecting ${candidatePreview.coordinate}, ${candidatePreview.title}. This is a non-committing location and exact-shape preview; no engine ownership map is supplied.`, `正在查看 ${candidatePreview.coordinate}，${candidatePreview.title}。这是不落子的位置与确定棋形预览；未提供引擎归属图。`, `${candidatePreview.coordinate}（${candidatePreview.title}）を確認中です。着手しない場所と正確な形のプレビューで、エンジン帰属図はありません。`)
          : selected
          ? `${pointToCoordinate(selected, size)} ${authored(locale, 'selected.', '已选中。', 'を選択中。')} ${preview ? (preview.legal ? t('board.moveLegal') : t('board.moveIllegal', { reason: localizeRulesReason(preview.reason, locale) ?? t('board.unknownReason') })) : t('board.checkingConsequences')}`
          : t('board.toPlay', { color: toPlay === 'black' ? t('board.black') : t('board.white') })}
      </div>
      </div>

      {candidatePreview && (
        <section
          className="candidate-field-key"
          aria-label={candidateEngineField
            ? candidatePreviewMode === 'suggested-first-stone'
              ? authored(locale, `Suggested first stone ${candidatePreview.coordinate} with if-played engine forecast`, `建议第一手 ${candidatePreview.coordinate}，带“如果下在此处”的引擎预测`, `おすすめの第一手 ${candidatePreview.coordinate}、着手時のエンジン予測付き`)
              : candidatePreviewMode === 'if-played'
                ? authored(locale, `Unconfirmed analysis if ${toPlay} plays ${candidatePreview.coordinate}`, `${toPlay === 'black' ? '黑棋' : '白棋'}下在 ${candidatePreview.coordinate} 的未确认分析`, `${toPlay === 'black' ? '黒' : '白'}が ${candidatePreview.coordinate} に打つ場合の未確定分析`)
                : authored(locale, `Engine forecast after candidate ${candidatePreview.coordinate}`, `候选着 ${candidatePreview.coordinate} 后的引擎预测`, `候補手 ${candidatePreview.coordinate} 後のエンジン予測`)
            : candidateIsPass
              ? authored(locale, 'Pass preview with no stone placement and no ownership map', '停一手预览：不落子，也没有归属图', 'パスプレビュー：着手と帰属図はありません')
              : authored(locale, `Location and exact-shape preview for candidate ${candidatePreview.coordinate}`, `候选着 ${candidatePreview.coordinate} 的位置与确定棋形预览`, `候補手 ${candidatePreview.coordinate} の場所と正確な形のプレビュー`)}
          aria-live="polite"
          data-testid="candidate-field-key"
          data-candidate-id={candidatePreview.id}
          data-engine-field={candidateEngineField}
          data-preview-mode={candidatePreviewMode ?? 'inspection'}
        >
          <div className="candidate-field-title">
            <div>
              <small>{candidatePreviewMode === 'suggested-first-stone'
                ? authored(locale, 'Suggested first stone · nothing placed', '建议的第一手 · 尚未落子', 'おすすめの第一手 · 未着手')
                : candidatePreviewMode === 'if-played'
                  ? authored(locale, 'If played · still unconfirmed', '如果下在此处 · 仍未确认', 'ここに打った場合 · まだ未確定')
                  : authored(locale, 'Inspecting without placing', '只观察，不落子', '着手せずに調べる')}</small>
              <strong>{candidateEngineField
                ? candidatePreviewMode === 'suggested-first-stone'
                  ? authored(locale, `${candidatePreview.coordinate} · suggested opening with if-played forecast`, `${candidatePreview.coordinate} · 建议开局与着后预测`, `${candidatePreview.coordinate} · おすすめ序盤手と着手後予測`)
                  : candidatePreviewMode === 'if-played'
                    ? authored(locale, `${candidatePreview.coordinate} · board if ${toPlay} played here`, `${candidatePreview.coordinate} · ${toPlay === 'black' ? '黑棋' : '白棋'}下在此处后的棋盘`, `${candidatePreview.coordinate} · ${toPlay === 'black' ? '黒' : '白'}がここに打った盤面`)
                    : authored(locale, `${candidatePreview.coordinate} · engine forecast after this candidate`, `${candidatePreview.coordinate} · 候选着后的引擎预测`, `${candidatePreview.coordinate} · 候補手後のエンジン予測`)
                : candidateIsPass
                  ? authored(locale, 'Pass · no stone is placed', '停一手 · 不落子', 'パス · 石は打たれない')
                  : authored(locale, `${candidatePreview.coordinate} · location and exact-shape preview`, `${candidatePreview.coordinate} · 位置与确定棋形预览`, `${candidatePreview.coordinate} · 場所と正確な形のプレビュー`)}</strong>
            </div>
            <span className={`evidence-badge ${candidateEngineField ? 'engine' : 'metaphor'}`}>
              {candidateEngineField
                ? t('evidence.engine')
                : size < 9
                  ? authored(locale, `Authored ${size}×${size} view`, `人工编写的 ${size}×${size} 视图`, `教材用の ${size}×${size} 表示`)
                  : candidateIsPass
                    ? authored(locale, 'Pass preview · no map supplied', '停一手预览 · 未提供分布图', 'パスプレビュー · 図なし')
                    : authored(locale, 'Location preview · no field supplied', '位置预览 · 未提供分布场', '場所プレビュー · 分布なし')}
            </span>
          </div>

          {candidateEngineField ? (
            <div className="candidate-field-modes" role="list" aria-label={authored(locale, 'Candidate field modes', '候选着分布图模式', '候補手の分布モード')}>
              {candidateOwnershipVisible && (
                <span role="listitem" data-field-mode="after-candidate">
                  <i className="field-after" /><span><b>{authored(locale, 'After this move', '这手之后', 'この手の後')}</b>{authored(locale, `Ownership forecast after ${candidatePreview.coordinate}`, `${candidatePreview.coordinate} 后的归属预测`, `${candidatePreview.coordinate} 後の帰属予測`)}</span>
                </span>
              )}
              {candidateDelta.length > 0 && (
                <span role="listitem" data-field-mode="change-vs-current">
                  <i className="field-delta" /><span><b>{authored(locale, 'Forecast difference after this move vs current', '这手后与当前局面的预测差异', '着手後と現在局面の予測差')}</b>{authored(locale, 'Strongest displayed signed changes · blue toward Black, orange toward White', '显示最强的带符号变化 · 蓝色偏向黑，橙色偏向白', '表示される最大の符号付き変化 · 青は黒寄り、オレンジは白寄り')}</span>
                </span>
              )}
              <span role="listitem">
                <i className="field-black" /><span><b>{authored(locale, 'Blue', '蓝色', '青')}</b>{authored(locale, 'More Black ownership tendency', '更偏向黑棋归属', '黒の帰属傾向が強い')}</span>
              </span>
              <span role="listitem">
                <i className="field-white" /><span><b>{authored(locale, 'Orange', '橙色', 'オレンジ')}</b>{authored(locale, 'More White ownership tendency', '更偏向白棋归属', '白の帰属傾向が強い')}</span>
              </span>
              <span role="listitem">
                <i className="field-variation" /><span><b>{t('board.violet')}</b>{authored(locale, 'Contested or high variation across searched lines', '争夺激烈，或搜索变化间的差异较大', '競合または探索線間のばらつきが大きい')}</span>
              </span>
              {!candidateVariationAvailable && (
                <span role="listitem">
                  <i className="field-unknown" /><span><b>{authored(locale, 'Gray', '灰色', '灰色')}</b>{authored(locale, 'Continuation variation was not supplied', '未提供后续变化分散度', '続行変化のばらつきは提供されていない')}</span>
                </span>
              )}
            </div>
          ) : (
            <p className="candidate-field-missing" role="note">
              {size < 9
                ? t('board.noSmallBoardMap', { size })
                : candidateIsPass
                  ? t('board.noPassMap')
                  : t('board.noMoveMap')}
            </p>
          )}

          <div className="candidate-field-facts">
            {candidatePreview.tactics && (
              <span><b>{t('source.exactRules')}</b>{candidatePreview.kind === 'pass' || candidatePreview.point == null
                ? candidatePreview.tactics.ends_play
                  ? t('board.passEnds')
                  : t('board.passContinues')
                : t('board.tacticsFacts', {
                    captures: candidatePreview.tactics.captures.length,
                    liberties: candidatePreview.tactics.resulting_liberties ?? t('board.unreported'),
                    connections: candidatePreview.tactics.connects.length,
                    cuts: candidatePreview.tactics.cuts.length,
                  })}</span>
            )}
            {candidateDelta.length > 0 && candidateEngineField && (
              <span><b>{t('source.teacher')}</b>{t('board.teacherWeather')}</span>
            )}
            {candidatePreview.variation?.length ? (
              <span><b>{t('source.engine')}</b>{t('board.engineLine')}</span>
            ) : null}
            {candidatePreview.score && candidatePreview.engine_analyzed && (
              <span data-testid="if-played-score-forecast">
                <b>{t('board.scoreForecastBlack')}</b>
                {t('board.scoreForecastValues', {
                  before: candidatePreview.score.before.toFixed(1),
                  after: candidatePreview.score.after.toFixed(1),
                  delta: `${candidatePreview.score.delta >= 0 ? '+' : ''}${candidatePreview.score.delta.toFixed(1)}`,
                })}
                {candidatePreview.score.mover_delta != null
                  ? t('board.scoreForecastMover', {
                      color: toPlay === 'black' ? t('board.black') : t('board.white'),
                      delta: `${candidatePreview.score.mover_delta >= 0 ? '+' : ''}${candidatePreview.score.mover_delta.toFixed(1)}`,
                    })
                  : ''}
              </span>
            )}
          </div>
          <p className="candidate-field-disclaimer">
            {candidateEngineField
              ? candidateVariationAvailable
                ? t('board.ownershipDisclaimerWithVariation')
                : t('board.ownershipDisclaimerNoVariation')
              : candidateIsPass
                ? t('board.passOverlayDisclaimer')
                : t('board.locationOverlayDisclaimer')}
          </p>
        </section>
      )}

      {selected && (
        <section
          className="unconfirmed-analysis"
          data-testid="unconfirmed-analysis"
          data-coordinate={pointToCoordinate(selected, size)}
          data-analysis-state={
            operationStatus === 'previewing' && !preview
              ? 'analyzing'
              : preview?.legal
                ? candidateEngineField
                  ? 'ready'
                  : 'no-map'
                : preview
                  ? 'illegal'
                  : 'analyzing'
          }
          role="status"
          aria-live="polite"
        >
          <strong>
            {operationStatus === 'previewing' && !preview
              ? authored(locale, `Analyzing if ${toPlay} plays ${pointToCoordinate(selected, size)}…`, `正在分析${toPlay === 'black' ? '黑棋' : '白棋'}下在 ${pointToCoordinate(selected, size)} 后的局面…`, `${toPlay === 'black' ? '黒' : '白'}が ${pointToCoordinate(selected, size)} に打った場合を解析中…`)
              : preview?.legal
                ? authored(locale, `If ${toPlay} plays ${pointToCoordinate(selected, size)} · analysis ready`, `${toPlay === 'black' ? '黑棋' : '白棋'}若下在 ${pointToCoordinate(selected, size)} · 分析已就绪`, `${toPlay === 'black' ? '黒' : '白'}が ${pointToCoordinate(selected, size)} に打つ場合 · 解析準備完了`)
                : preview
                  ? authored(locale, `${pointToCoordinate(selected, size)} cannot be played now`, `${pointToCoordinate(selected, size)} 当前不能下`, `${pointToCoordinate(selected, size)} には現在打てません`)
                  : authored(locale, `Analyzing ${pointToCoordinate(selected, size)}…`, `正在分析 ${pointToCoordinate(selected, size)}…`, `${pointToCoordinate(selected, size)} を解析中…`)}
          </strong>
          <span>
            {operationStatus === 'previewing' && !preview
              ? authored(locale, 'No stone has been placed. Waiting for exact consequences and any after-move ownership and score forecast.', '尚未落子。正在等待确定后果，以及可能的着后归属和目数预测。', '石は打たれていません。正確な結果と、提供される場合は着手後の帰属・得点予測を待っています。')
              : preview?.legal && candidateEngineField
                ? authored(locale, 'The if-played field and explanation are visible above. Nothing changes until you separately choose Place stone.', '上方已显示“如果下在此处”的分布与解释。在你另行选择“确认落子”前，棋盘不会改变。', '「ここに打った場合」の分布と説明は上に表示されています。別途「石を打つ」を選ぶまで盤面は変わりません。')
              : preview?.legal
                  ? authored(locale, 'The move is legal and exact consequences are shown, but no after-move ownership map was supplied. Nothing has been placed.', '着法合法且已显示确定后果，但未提供着后归属图。尚未落子。', '合法手で正確な結果が表示されていますが、着手後の帰属図は提供されていません。まだ着手していません。')
                  : preview
                    ? `${localizeRulesReason(preview.reason, locale) ?? t('coach.notLegalNow')} ${t('board.nothingPlaced')}`
                    : t('board.nothingPlaced')}
          </span>
          {preview?.legal && preview.current_area_snapshot && preview.if_played_area_snapshot && (
            <div className="position-bookkeeping-comparison" data-testid="if-played-position-comparison">
              <article data-testid="current-position-bookkeeping">
                <small>{t('board.currentBoard')}</small>
                <strong>{t('board.stoneCount', { black: preview.current_area_snapshot.black_stones, white: preview.current_area_snapshot.white_stones })}</strong>
                <span>{t('board.emptyTurn', { count: size * size - preview.current_area_snapshot.black_stones - preview.current_area_snapshot.white_stones, color: locale === 'en' ? toPlay : toPlay === 'black' ? t('board.black') : t('board.white') })}</span>
              </article>
              <span className="position-comparison-arrow" aria-hidden="true">→</span>
              <article data-testid="if-played-position-bookkeeping">
                <small>{t('board.ifPlays', { color: toPlay === 'black' ? t('board.black') : t('board.white'), coordinate: preview.coordinate })}</small>
                <strong>{t('board.stoneCount', { black: preview.if_played_area_snapshot.black_stones, white: preview.if_played_area_snapshot.white_stones })}</strong>
                <span>{t('board.emptyTurn', { count: size * size - preview.if_played_area_snapshot.black_stones - preview.if_played_area_snapshot.white_stones, color: locale === 'en' ? preview.if_played_side_to_move ?? (toPlay === 'black' ? 'white' : 'black') : (preview.if_played_side_to_move ?? (toPlay === 'black' ? 'white' : 'black')) === 'black' ? t('board.black') : t('board.white') })}</span>
              </article>
              <p>{t('board.noTerritory')}</p>
            </div>
          )}
        </section>
      )}

      {presenceSketchVisible && (
        <section className="power-cloud-key" aria-label={t('board.presenceExplanation')} data-testid="power-cloud-key">
          <div className="power-cloud-title">
            <strong>{openingCloud ? t('board.openingSketch') : t('board.distanceSketch')}</strong>
            <span className="evidence-badge metaphor">{t('board.analogy')}</span>
          </div>
          {openingCloud ? (
            <div className="power-cloud-items">
              <span><i className="corner" /> <b>{t('board.corner')}</b> · {t('board.cornerText')}</span>
              <span><i className="side" /> <b>{t('board.side')}</b> · {t('board.sideText')}</span>
              <span><i className="center" /> <b>{t('board.center')}</b> · {t('board.centerText')}</span>
            </div>
          ) : (
            <div className="power-cloud-items">
              <span><i className="black" /> <b>{t('board.black')}</b> · {t('board.nearby')}</span>
              <span><i className="white" /> <b>{t('board.white')}</b> · {t('board.nearby')}</span>
              <span><i className="contested" /> <b>{t('board.violet')}</b> · {t('board.bothClose')}</span>
            </div>
          )}
          <p>
            {t('board.sketchDisclaimer')}
            {size < 9
              ? ` ${t('board.smallBoardDisclaimer', { size })}`
              : engineLayerVisible
                ? ` ${t('board.separateEstimate')}`
                : ''}
          </p>
        </section>
      )}
    </div>
  )
}
