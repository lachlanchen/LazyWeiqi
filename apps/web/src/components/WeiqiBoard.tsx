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
  stableGround,
  stoneMap,
  teachingPresenceField,
} from '../board'
import type { BoardSize, MovePreview, MoveRecord, OwnershipCell, Point, Stone, StoneColor } from '../types'

export type EnergyLensId = 'cloud' | 'breath' | 'bonds' | 'shelter' | 'reach' | 'ground' | 'beat'

interface WeiqiBoardProps {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  selected: Point | null
  onSelect: (point: Point) => void
  preview?: MovePreview | null
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
  preview,
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
  const ownershipByPoint = useMemo(() => ownershipMap(ownership), [ownership])
  const previewStone = Boolean(
    selected &&
      preview?.legal &&
      samePoint(selected, preview.point) &&
      !occupied.has(pointKey(selected)),
  )
  const visualStones = useMemo(
    () => previewStone && selected ? [...stones, { ...selected, color: toPlay }] : stones,
    [previewStone, selected, stones, toPlay],
  )
  const presenceField = useMemo(
    () => teachingPresenceField(visualStones, size),
    [size, visualStones],
  )
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
  const openingCloud = cloudVisible && visualStones.length === 0
  const engineLayerVisible = Boolean(
    ownership?.length && (activeLenses.has('reach') || activeLenses.has('ground')),
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
      >
      <svg
        className="weiqi-board"
        viewBox={`0 0 ${BOARD_EDGE} ${BOARD_EDGE}`}
        role="grid"
        aria-label={`${size} by ${size} Weiqi board. ${toPlay} to play.`}
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

        {cloudVisible && visualStones.length > 0 && (
          <g
            className="stone-presence-cloud"
            data-testid="stone-presence-cloud"
            data-preview={previewStone ? 'true' : 'false'}
            clipPath={`url(#${cloudIds.clip})`}
            aria-hidden="true"
          >
            <g data-field="black">
              {visualStones.filter((stone) => stone.color === 'black').map((stone, index) => {
                const { x, y } = position(stone)
                return <circle key={`black-cloud-${pointKey(stone)}-${index}`} cx={x} cy={y} r={step * (size === 5 ? 2.05 : 2.45)} fill={`url(#${cloudIds.black})`} opacity=".72" />
              })}
            </g>
            <g data-field="white">
              {visualStones.filter((stone) => stone.color === 'white').map((stone, index) => {
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

        {(activeLenses.has('reach') || activeLenses.has('ground')) &&
          points.map((point) => {
            const cell = ownershipByPoint.get(pointKey(point))
            if (!cell) return null
            const stable = stableGround(cell)
            if (activeLenses.has('ground') && !stable && !activeLenses.has('reach')) return null
            if (!activeLenses.has('reach') && !stable) return null
            const kind = ownershipClass(cell)
            const { x, y } = position(point)
            const opacity = Math.min(0.34, 0.08 + Math.abs(cell.value) * 0.22)
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
                opacity={kind === 'mist' ? 0.5 : opacity}
                className={stable ? 'ownership-cell stable' : 'ownership-cell'}
                aria-hidden="true"
              />
            )
          })}

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

        {selected && !occupied.has(pointKey(selected)) && (() => {
          const { x, y } = position(selected)
          return (
            <g className={`selected-stone ${toPlay}`} aria-hidden="true">
              <circle cx={x} cy={y} r={step * 0.43} className="selected-ghost" />
              <circle cx={x} cy={y} r={step * 0.51} className="selected-ring" />
            </g>
          )
        })()}

        {preview?.captures.map((captured) => {
          const { x, y } = position(captured)
          return <path key={`capture-${pointKey(captured)}`} d={`M ${x - 8} ${y - 8} L ${x + 8} ${y + 8} M ${x + 8} ${y - 8} L ${x - 8} ${y + 8}`} className="capture-mark" aria-hidden="true" />
        })}

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
        {selected
          ? `${pointToCoordinate(selected, size)} selected. ${preview ? (preview.legal ? 'Move is legal.' : `Move is not legal: ${preview.reason ?? 'unknown reason'}.`) : 'Checking consequences.'}`
          : `${toPlay} to play.`}
      </div>
      </div>

      {cloudVisible && (
        <section className="power-cloud-key" aria-label="Power cloud explanation" data-testid="power-cloud-key">
          <div className="power-cloud-title">
            <strong>{openingCloud ? 'Opening map' : 'Stone-presence cloud'}</strong>
            <span className="evidence-badge metaphor">Teaching metaphor</span>
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
            This soft cloud is a distance-based visual analogy—not physics, territory, or a score.
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
