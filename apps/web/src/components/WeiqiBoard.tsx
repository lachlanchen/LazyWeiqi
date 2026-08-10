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
        aria-label={`${size} by ${size} Weiqi board. ${toPlay} to play.`}
        aria-keyshortcuts={selectionClearable ? 'Escape' : undefined}
        data-testid="weiqi-board"
      >
        <title>{`${size} by ${size} Weiqi board, ${toPlay} to play`}</title>
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
                  <text x={x} y={y + 3.2} textAnchor="middle">L{candidateLiberties}</text>
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
              <text x={labelX + labelWidth / 2} y={labelY + 18} textAnchor="middle">Suggested first: {candidatePreview?.coordinate}</text>
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
                ? `${coordinate}, ${stone.color} stone${samePoint(stone, lastMovePoint) ? ', last move' : ''}`
                : `${coordinate}, empty${selectedHere ? ', selected for preview' : ''}`
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
            ? `Suggested first stone: ${candidatePreview.coordinate}. Nothing has been placed. Click this point or any legal empty intersection to analyze what would happen before deciding.`
            : candidatePreviewMode === 'if-played'
              ? `If ${toPlay} played ${candidatePreview.coordinate}, this non-committing analysis would apply. No stone has been placed.`
              : candidateEngineField
            ? `Inspecting ${candidatePreview.coordinate}, ${candidatePreview.title}. This is a non-committing engine candidate forecast.`
            : candidateIsPass
              ? `Inspecting pass, ${candidatePreview.title}. This is a non-committing pass preview; no stone is placed and no engine ownership map is supplied.`
              : `Inspecting ${candidatePreview.coordinate}, ${candidatePreview.title}. This is a non-committing location and exact-shape preview; no engine ownership map is supplied.`
          : selected
          ? `${pointToCoordinate(selected, size)} selected. ${preview ? (preview.legal ? 'Move is legal.' : `Move is not legal: ${preview.reason ?? 'unknown reason'}.`) : 'Checking consequences.'}`
          : `${toPlay} to play.`}
      </div>
      </div>

      {candidatePreview && (
        <section
          className="candidate-field-key"
          aria-label={candidateEngineField
            ? candidatePreviewMode === 'suggested-first-stone'
              ? `Suggested first stone ${candidatePreview.coordinate} with if-played engine forecast`
              : candidatePreviewMode === 'if-played'
                ? `Unconfirmed analysis if ${toPlay} plays ${candidatePreview.coordinate}`
                : `Engine forecast after candidate ${candidatePreview.coordinate}`
            : candidateIsPass
              ? 'Pass preview with no stone placement and no ownership map'
              : `Location and exact-shape preview for candidate ${candidatePreview.coordinate}`}
          aria-live="polite"
          data-testid="candidate-field-key"
          data-candidate-id={candidatePreview.id}
          data-engine-field={candidateEngineField}
          data-preview-mode={candidatePreviewMode ?? 'inspection'}
        >
          <div className="candidate-field-title">
            <div>
              <small>{candidatePreviewMode === 'suggested-first-stone'
                ? 'Suggested first stone · nothing placed'
                : candidatePreviewMode === 'if-played'
                  ? 'If played · still unconfirmed'
                  : 'Inspecting without placing'}</small>
              <strong>{candidateEngineField
                ? candidatePreviewMode === 'suggested-first-stone'
                  ? `${candidatePreview.coordinate} · suggested opening with if-played forecast`
                  : candidatePreviewMode === 'if-played'
                    ? `${candidatePreview.coordinate} · board if ${toPlay} played here`
                    : `${candidatePreview.coordinate} · engine forecast after this candidate`
                : candidateIsPass
                  ? 'Pass · no stone is placed'
                  : `${candidatePreview.coordinate} · location and exact-shape preview`}</strong>
            </div>
            <span className={`evidence-badge ${candidateEngineField ? 'engine' : 'metaphor'}`}>
              {candidateEngineField
                ? 'Engine estimate'
                : size < 9
                  ? `Authored ${size}×${size} view`
                  : candidateIsPass
                    ? 'Pass preview · no map supplied'
                    : 'Location preview · no field supplied'}
            </span>
          </div>

          {candidateEngineField ? (
            <div className="candidate-field-modes" role="list" aria-label="Candidate field modes">
              {candidateOwnershipVisible && (
                <span role="listitem" data-field-mode="after-candidate">
                  <i className="field-after" /><span><b>After this move</b>Ownership forecast after {candidatePreview.coordinate}</span>
                </span>
              )}
              {candidateDelta.length > 0 && (
                <span role="listitem" data-field-mode="change-vs-current">
                  <i className="field-delta" /><span><b>Forecast difference after this move vs current</b>Strongest displayed signed changes · blue toward Black, orange toward White</span>
                </span>
              )}
              <span role="listitem">
                <i className="field-black" /><span><b>Blue</b>More Black ownership tendency</span>
              </span>
              <span role="listitem">
                <i className="field-white" /><span><b>Orange</b>More White ownership tendency</span>
              </span>
              <span role="listitem">
                <i className="field-variation" /><span><b>Violet</b>Contested or high variation across searched lines</span>
              </span>
              {!candidateVariationAvailable && (
                <span role="listitem">
                  <i className="field-unknown" /><span><b>Gray</b>Continuation variation was not supplied</span>
                </span>
              )}
            </div>
          ) : (
            <p className="candidate-field-missing" role="note">
              {size < 9
                ? `No KataGo map is claimed for this authored ${size}×${size} lesson. The ghost stone shows location only.`
                : candidateIsPass
                  ? 'No after-pass ownership field was supplied. Pass places no stone; no quality shape is invented.'
                  : 'No after-move ownership field was supplied. The ghost stone shows location only; no quality shape is invented.'}
            </p>
          )}

          <div className="candidate-field-facts">
            {candidatePreview.tactics && (
              <span><b>Exact rules</b>{candidatePreview.kind === 'pass' || candidatePreview.point == null
                ? candidatePreview.tactics.ends_play
                  ? 'This second consecutive pass places no stone, captures nothing, and ends play.'
                  : 'Pass places no stone or captures; the opponent moves next, and another consecutive pass ends play.'
                : `${candidatePreview.tactics.captures.length} captures · ${candidatePreview.tactics.resulting_liberties ?? 'unreported'} resulting liberties · ${candidatePreview.tactics.connects.length} connection anchors · ${candidatePreview.tactics.cuts.length} cut anchors`}</span>
            )}
            {candidateDelta.length > 0 && candidateEngineField && (
              <span><b>Teacher interpretation</b>Use the wash like a weather forecast, not a force field. Liberties, connections, threats, and replies are the causes.</span>
            )}
            {candidatePreview.variation?.length ? (
              <span><b>Engine main line</b>Numbered stones show one searched line, not a forced reply.</span>
            ) : null}
            {candidatePreview.score && candidatePreview.engine_analyzed && (
              <span data-testid="if-played-score-forecast">
                <b>Score forecast · Black perspective</b>
                Before {candidatePreview.score.before.toFixed(1)} → if played {candidatePreview.score.after.toFixed(1)} · search difference {candidatePreview.score.delta >= 0 ? '+' : ''}{candidatePreview.score.delta.toFixed(1)}
                {candidatePreview.score.mover_delta != null ? ` · for ${toPlay === 'black' ? 'Black' : 'White'} ${candidatePreview.score.mover_delta >= 0 ? '+' : ''}${candidatePreview.score.mover_delta.toFixed(1)}` : ''}
              </span>
            )}
          </div>
          <p className="candidate-field-disclaimer">
            {candidateEngineField
              ? `Ownership colors are a forecast, not territory already secured. The delta layer shows only the strongest changes above its display cutoff; omitted cells are not neutral. ${candidateVariationAvailable ? 'Cell variation describes spread across searched continuations. On the delta wash, that spread belongs to the after-position, not to the subtraction itself.' : 'No continuation-variation map was supplied, so gray marks unknown variation and no stability claim is made.'} Values are always Black perspective, including when White is to play.`
              : candidateIsPass
                ? 'This pass preview shows exact turn consequences but no stone location. It invents no ownership shape or territory map; any separate rank or score evidence remains separately labeled.'
                : 'This board overlay shows only the proposed location and exact rules facts. It invents no ownership shape or territory map; any separate rank or score evidence remains separately labeled.'}
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
              ? `Analyzing if ${toPlay} plays ${pointToCoordinate(selected, size)}…`
              : preview?.legal
                ? `If ${toPlay} plays ${pointToCoordinate(selected, size)} · analysis ready`
                : preview
                  ? `${pointToCoordinate(selected, size)} cannot be played now`
                  : `Analyzing ${pointToCoordinate(selected, size)}…`}
          </strong>
          <span>
            {operationStatus === 'previewing' && !preview
              ? 'No stone has been placed. Waiting for exact consequences and any after-move ownership and score forecast.'
              : preview?.legal && candidateEngineField
                ? 'The if-played field and explanation are visible above. Nothing changes until you separately choose Place stone.'
                : preview?.legal
                  ? 'The move is legal and exact consequences are shown, but no after-move ownership map was supplied. Nothing has been placed.'
                  : preview
                    ? `${preview.reason ?? 'The rules service rejected this move.'} Nothing has been placed.`
                    : 'No stone has been placed.'}
          </span>
          {preview?.legal && preview.current_area_snapshot && preview.if_played_area_snapshot && (
            <div className="position-bookkeeping-comparison" data-testid="if-played-position-comparison">
              <article data-testid="current-position-bookkeeping">
                <small>Current board</small>
                <strong>Stones · Black {preview.current_area_snapshot.black_stones} · White {preview.current_area_snapshot.white_stones}</strong>
                <span>{size * size - preview.current_area_snapshot.black_stones - preview.current_area_snapshot.white_stones} empty intersections · {toPlay} to move</span>
              </article>
              <span className="position-comparison-arrow" aria-hidden="true">→</span>
              <article data-testid="if-played-position-bookkeeping">
                <small>If {toPlay} plays {preview.coordinate}</small>
                <strong>Stones · Black {preview.if_played_area_snapshot.black_stones} · White {preview.if_played_area_snapshot.white_stones}</strong>
                <span>{size * size - preview.if_played_area_snapshot.black_stones - preview.if_played_area_snapshot.white_stones} empty intersections · {preview.if_played_side_to_move ?? (toPlay === 'black' ? 'white' : 'black')} to move</span>
              </article>
              <p>No territory is settled during live play. Use the labeled ownership cloud and score forecast above to compare likely future control.</p>
            </div>
          )}
        </section>
      )}

      {presenceSketchVisible && (
        <section className="power-cloud-key" aria-label="Beginner presence sketch explanation" data-testid="power-cloud-key">
          <div className="power-cloud-title">
            <strong>{openingCloud ? 'Opening efficiency sketch' : 'Current-stone distance sketch'}</strong>
            <span className="evidence-badge metaphor">Beginner analogy · not move quality</span>
          </div>
          {openingCloud ? (
            <div className="power-cloud-items">
              <span><i className="corner" /> <b>Corner</b> · fewer directions to close</span>
              <span><i className="side" /> <b>Side</b> · links nearby stones</span>
              <span><i className="center" /> <b>Center</b> · reaches far, encloses slowly</span>
            </div>
          ) : (
            <div className="power-cloud-items">
              <span><i className="black" /> <b>Black</b> · nearby presence</span>
              <span><i className="white" /> <b>White</b> · nearby presence</span>
              <span><i className="contested" /> <b>Violet</b> · both are close</span>
            </div>
          )}
          <p>
            This beginner sketch only shows distance from current stones. It does not rank candidates and is not physics, territory, ownership, or score.
            {size < 9
              ? ` This is an authored ${size}×${size} teaching view; the installed KataGo evidence is 9×9 only.`
              : engineLayerVisible
                ? ' The separate square wash is a KataGo ownership estimate.'
                : ''}
          </p>
        </section>
      )}
    </div>
  )
}
