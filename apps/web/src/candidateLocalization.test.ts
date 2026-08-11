import { describe, expect, it } from 'vitest'
import { DEMO_GAME } from './fallbackData'
import { localizeCandidate, localizeGame, localizeMovePreview } from './i18n'
import type { CandidateMove, MovePreview } from './types'

const knownCandidate: CandidateMove = {
  id: 'm_0123456789abcdef0123456789abcdef',
  kind: 'play',
  point: { x: 2, y: 2 },
  coordinate: 'C3',
  intent: 'pressure',
  intent_evidence: 'teacher',
  title: 'Possible fighting idea',
  summary: 'Capture 2 stone(s) and change the liberty balance now.',
  main_line_reply: 'White D4',
  risk: 'The resulting group has only one liberty; read the immediate reply.',
  why_here: 'Capture 2 stone(s) and change the liberty balance now.',
  what_changes: 'Rules: captures 2 stone(s); joins 2 friendly groups; takes 1 friendly group(s) out of atari; puts 1 opposing group(s) in atari; occupies a shared connection point between opposing groups; leaves a 3-stone group with 4 liberties.',
  next_calculation: 'The resulting group has only one liberty; read the immediate reply.',
  verified: true,
  legal_verified: true,
  engine_analyzed: true,
}

describe('deterministic candidate localization', () => {
  it('localizes the complete reviewed Chinese template while preserving protocol and provenance fields', () => {
    const localized = localizeCandidate(knownCandidate, 'zh-Hans')

    expect(localized).not.toBe(knownCandidate)
    expect(localized.coordinate).toBe('C3')
    expect(localized.intent).toBe('pressure')
    expect(localized.intent_evidence).toBe('teacher')
    expect(localized.engine_analyzed).toBe(true)
    expect(localized.title).toBe('可能的战斗手段')
    expect(localized.summary).toBe('立即提掉 2 枚棋子，并改变气的平衡。')
    expect(localized.main_line_reply).toBe('白棋 D4')
    expect(localized.risk).toBe('着后的棋块只有一口气；请计算对手的立即回应。')
    expect(localized.why_here).toBe(localized.summary)
    expect(localized.what_changes).toBe('规则：提掉 2 枚棋子；连接 2 块友军；让 1 块友军逃出叫吃；使 1 块对方棋被叫吃；占据对方棋块之间共享的连接点；形成 3 子棋块并有 4 口气。')
    expect(localized.next_calculation).toBe(localized.risk)
    expect(knownCandidate.title).toBe('Possible fighting idea')
  })

  it('localizes pass and the structured engine reply without claiming that pass ends play', () => {
    const pass = localizeCandidate({
      ...knownCandidate,
      kind: 'pass',
      point: null,
      coordinate: 'pass',
      intent: 'endgame',
      title: 'Possible end-of-game judgment',
      summary: 'Passing places no stone. The two-consecutive-pass ending rule applies.',
      main_line_reply: 'Black pass',
      risk: 'The opponent may still have a valuable move; passing does not prove the board is settled.',
      why_here: 'Passing places no stone. The two-consecutive-pass ending rule applies.',
      what_changes: 'Rules: pass places no stone or captures; the two-consecutive-pass ending rule applies.',
      next_calculation: 'The opponent may still have a valuable move; passing does not prove the board is settled.',
    }, 'ja')

    expect(pass.coordinate).toBe('パス')
    expect(pass.intent).toBe('endgame')
    expect(pass.title).toBe('終局判断の候補')
    expect(pass.summary).toContain('2 回連続パスの終局規則')
    expect(pass.summary).not.toContain('終局します')
    expect(pass.main_line_reply).toBe('黒 パス')
    expect(pass.what_changes).toContain('石を打たず、取りもありません')
  })

  it('leaves unmatched model or engine prose byte-for-byte unchanged', () => {
    const dynamic: CandidateMove = {
      ...knownCandidate,
      title: 'Network-specific title',
      summary: 'Model-specific summary with C3 and White.',
      main_line_reply: 'White approaches at D4 because the network prefers it.',
      risk: 'Model-specific risk.',
      why_here: 'Model-specific why.',
      what_changes: 'Rules-ish but unreviewed prose.',
      next_calculation: 'Model-specific calculation.',
    }
    const localized = localizeCandidate(dynamic, 'zh-Hans')

    expect(localized.title).toBe(dynamic.title)
    expect(localized.summary).toBe(dynamic.summary)
    expect(localized.main_line_reply).toBe(dynamic.main_line_reply)
    expect(localized.risk).toBe(dynamic.risk)
    expect(localized.why_here).toBe(dynamic.why_here)
    expect(localized.what_changes).toBe(dynamic.what_changes)
    expect(localized.next_calculation).toBe(dynamic.next_calculation)
  })

  it('projects localized candidates through both game analysis and move preview teaching', () => {
    const game = localizeGame({
      ...DEMO_GAME,
      analysis: { status: 'ready', candidates: [knownCandidate] },
    }, 'ja')
    expect(game.analysis?.candidates?.[0].title).toBe('戦いの候補')

    const preview: MovePreview = {
      game_id: DEMO_GAME.id,
      revision: DEMO_GAME.revision,
      point: { x: 2, y: 2 },
      coordinate: 'C3',
      legal: true,
      captures: [],
      resulting_liberties: 4,
      facets: [],
      candidates: [knownCandidate],
      teaching: {
        ...knownCandidate,
        tactics: {
          captures: [],
          resulting_liberties: 4,
          connects: [],
          cuts: [],
          friendly_groups_joined: 0,
          opponent_groups_newly_in_atari: 0,
          friendly_groups_escaped_atari: 0,
          self_atari: false,
          evidence: 'exact',
        },
        why_here: knownCandidate.why_here!,
        what_changes: knownCandidate.what_changes!,
        next_calculation: knownCandidate.next_calculation!,
      },
      coach_prompt: 'Name the intention before committing: build, fight, escape, or connect?',
    }
    const localized = localizeMovePreview(preview, 'zh-Hans')

    expect(localized.candidates[0].title).toBe('可能的战斗手段')
    expect(localized.teaching?.summary).toBe('立即提掉 2 枚棋子，并改变气的平衡。')
    expect(localized.teaching?.main_line_reply).toBe('白棋 D4')
    expect(localized.coach_prompt).toContain('落子前先说出意图')
    expect(preview.candidates[0].title).toBe('Possible fighting idea')
  })
})
