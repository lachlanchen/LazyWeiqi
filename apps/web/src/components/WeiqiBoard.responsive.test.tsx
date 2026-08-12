import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WeiqiBoard } from './WeiqiBoard'

interface NodeProcess {
  getBuiltinModule(name: 'node:fs'): {
    readFileSync(path: URL, encoding: 'utf8'): string
  }
}

const nodeProcess = (globalThis as typeof globalThis & { process: NodeProcess }).process
const styles = nodeProcess.getBuiltinModule('node:fs')
  .readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

function cssBlock(source: string, selector: string): string {
  const selectorIndex = source.indexOf(selector)
  if (selectorIndex < 0) throw new Error(`Missing CSS selector: ${selector}`)
  const openingBrace = source.indexOf('{', selectorIndex + selector.length)
  if (openingBrace < 0) throw new Error(`Missing CSS block for: ${selector}`)

  let depth = 0
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(openingBrace + 1, index)
  }

  throw new Error(`Unclosed CSS block for: ${selector}`)
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('19x19 board rendering contract', () => {
  it('exposes the exact standard star-point coordinates in static markup', () => {
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={19}
        stones={[]}
        toPlay="black"
        selected={null}
        onSelect={() => undefined}
        activeLenses={new Set(['cloud'] as const)}
        showCoordinates
      />,
    )
    const starCoordinates = [...html.matchAll(/class="star-point" data-coordinate="([A-T]\d{1,2})"/g)]
      .map((match) => match[1])

    expect(starCoordinates).toEqual([
      'D16', 'K16', 'Q16',
      'D10', 'K10', 'Q10',
      'D4', 'K4', 'Q4',
    ])
    expect(html).toContain('aria-rowcount="19"')
    expect(html).toContain('aria-colcount="19"')
    expect(html).toContain('data-coordinate="T19"')
    expect(html).toContain('class="board-visual" data-board-size="19" data-presence-key="visible"')
  })

  it('keeps the board width-bounded from the desktop grid through mobile', () => {
    const layout = cssBlock(styles, '.play-layout')
    const column = cssBlock(styles, '.board-column')
    const visual = cssBlock(styles, '.board-visual')
    const frame = cssBlock(styles, '.board-frame')
    const svg = cssBlock(styles, '.weiqi-board')
    const fullBoard = cssBlock(styles, ".board-frame[data-board-size='19']")

    expect(layout).toContain('min-width: 0')
    expect(layout).toContain('max-width: 100%')
    expect(column).toContain('min-width: 0')
    expect(visual).toContain('min-width: 0')
    expect(visual).toContain('max-width: 100%')
    expect(frame).toContain('min-width: 0')
    expect(frame).toContain('max-width: 100%')
    expect(svg).toContain('max-width: 100%')
    expect(fullBoard).toContain('--board-coordinate-size: 11px')

    const narrowDesktop = cssBlock(styles, '@media (max-width: 1120px)')
    expect(cssBlock(narrowDesktop, '.play-layout')).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(320px, 360px)',
    )

    const mobile = cssBlock(styles, '@media (max-width: 680px)')
    expect(cssBlock(mobile, '.candidate-field-modes')).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )

    const tablet = cssBlock(styles, '@media (min-width: 681px) and (max-width: 900px)')
    expect(cssBlock(tablet, ".simple-play[data-board-size='19'] .play-layout")).toContain(
      'grid-auto-rows: max-content',
    )
    expect(cssBlock(tablet, ".simple-play[data-board-size='19'] .board-column")).toContain(
      'min-height: max-content',
    )
    expect(cssBlock(tablet, ".simple-play[data-board-size='19'] .board-stage")).toContain(
      'min-height: 628px',
    )

    const compactBoard = cssBlock(mobile, ".simple-play[data-board-size='19'] .board-visual")
    expect(cssBlock(mobile, ".simple-play[data-board-size='19'] .board-stage")).toContain(
      'container-type: size',
    )
    expect(compactBoard).toContain('width: min(calc(100% - 8px), calc(100cqh - 2px))')
    expect(compactBoard).toContain('min-width: 0')
    expect(cssBlock(mobile, ".simple-play[data-board-size='19'] .board-visual[data-presence-key='visible']")).toContain(
      'width: min(calc(100% - 8px), calc(100cqh - 24px))',
    )
  })

  it('keeps dense 19x19 targets separate without shrinking the 9x9 touch geometry', () => {
    const renderBoard = (size: 9 | 19) => renderToStaticMarkup(
      <WeiqiBoard
        size={size}
        stones={[]}
        toPlay="black"
        selected={null}
        onSelect={() => undefined}
        activeLenses={new Set()}
        showCoordinates
      />,
    )
    const hitRadius = (markup: string) => Number(
      markup.match(/<circle[^>]*r="([\d.]+)"[^>]*class="board-hit"/)?.[1],
    )
    const gridStep = (540 - 48 * 2) / 18
    const fullBoardRadius = hitRadius(renderBoard(19))
    const teachingBoardRadius = hitRadius(renderBoard(9))

    expect(fullBoardRadius).toBeLessThan(gridStep / 2)
    expect(fullBoardRadius).toBeCloseTo(gridStep * 0.47)
    expect(teachingBoardRadius).toBeGreaterThan(20)
  })

  it('keeps textbook modal prose readable, high-contrast, and scroll-contained', () => {
    expect(cssBlock(styles, '.opening-dialog-scroll')).toContain('overflow-y: auto')
    expect(cssBlock(styles, '.opening-book-section > p')).toContain('font-size: 0.96rem')
    expect(cssBlock(styles, '.opening-decision-grid p')).toContain('font-size: 0.9rem')
    expect(cssBlock(styles, '.opening-evidence-cards p')).toContain('font-size: 0.88rem')
    expect(cssBlock(styles, '.opening-sequence-list p')).toContain('font-size: 0.86rem')
    expect(cssBlock(styles, '.opening-sequence-disclaimer')).toContain('font-size: 0.9rem')
    expect(cssBlock(styles, '.opening-textbook-grid li p')).toContain('font-size: 0.86rem')
    expect(cssBlock(styles, '.opening-textbook-grid li small')).toContain('font-size: 0.78rem')
    expect(cssBlock(styles, '.opening-provenance-grid small')).toContain('font-size: 0.78rem')
    expect(cssBlock(cssBlock(styles, '@media (max-width: 430px)'), '.opening-book-section > p')).toContain('font-size: 0.9rem')

    const paleBackgrounds = ['#ffffff', '#eaf7f2', '#eff9fa', '#f8f3fb', '#fff9ed', '#faf7fc']
    for (const foreground of ['#4f686f', '#4f666e', '#4e656d', '#435f68', '#4c646c', '#536a72', '#654f72', '#1f6659']) {
      for (const background of paleBackgrounds) {
        expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
