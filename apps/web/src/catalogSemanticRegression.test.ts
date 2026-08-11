import { describe, expect, it } from 'vitest'
import { messagesForLocale } from './i18n'

const reviewedLocales = ['ar', 'ko', 'ru', 'vi'] as const

function catalogText(locale: (typeof reviewedLocales)[number]): string {
  return Object.values(messagesForLocale(locale)).join('\n')
}

describe('reviewed Arabic, Korean, Russian, and Vietnamese catalog semantics', () => {
  it('keeps first-party character names localized and invisible controls out of copy', () => {
    for (const locale of reviewedLocales) {
      const text = catalogText(locale)
      expect(text, `${locale}: English character-name leak`).not.toMatch(/\b(?:Lantern|River|Game)\b/)
      expect(text, `${locale}: zero-width-space leak`).not.toContain('\u200B')
    }
  })

  it('keeps Arabic labels grammatical and board accessibility text unambiguous', () => {
    const catalog = messagesForLocale('ar')

    expect(catalog['campaign.title']).toBe('ابدأ صغيرًا. واصل حتى تبلغ الوادي كاملًا.')
    expect(catalog['mode.description']).toBe('لا يختار وكلاء اللاعبين إلا نقلات مرشحة قانونية ومتحققًا من صحتها. ولا يلعب الرفيق أو الراوي بدل أي لون.')
    expect(catalog['mode.humanDescription']).toContain('بإرشادات درسية موجزة')
    expect(catalog['operation.coach']).toContain('شرحًا قائمًا على الأدلة')
    expect(catalog['coach.authorityTheatre']).toBe('يشرح السرد كلا المذهبين. لا يضع الأحجار إلا وكيلا اللاعبين.')
    expect(catalog['candidate.exact']).toBe('دقيق')
    expect(catalog['evidence.exact']).toBe('دقيق')
    expect(catalog['candidate.boardField']).toBe('عرض الرقعة')
    expect(catalog['energy.title']).toBe('شغّل طبقة واحدة واضحة أو أوقفها')
    expect(catalog['energy.noMagic']).toBe('لا توجد نتيجة سحرية')
    expect(catalog['lens.strong']).toBe('توقع قوي')
    expect(catalog['chronicle.eyebrow']).toBe('سجلك القصصي')
    expect(catalog['coach.delegationExplanation']).toBe(
      'بموجب سلطتك الصريحة، سيختار فانوس من بين المرشحين الذين تحقّق منهم الخادم والمرتبطين بوضع الرقعة الحالي. يبقى فانوس رفيقًا غير لاعب، وتظل كل الأدوار اللاحقة لك.',
    )
    expect(catalog['play.toPlay']).toBe('الدور: {name}')
    expect(catalog['board.grid']).toBe('رقعة Weiqi بحجم {size}×{size}. الدور: {color}.')
    expect(catalog['board.stone']).toBe('{coordinate}، حجر {color}{last}')
    expect(catalog['board.empty']).toBe('{coordinate}، تقاطع فارغ{selected}')
    expect(catalog['board.black']).toBe('الأسود')
    expect(catalog['board.white']).toBe('الأبيض')
    expect(catalog['board.toPlay']).toBe('الدور: {color}.')
    expect(catalog['board.emptyTurn']).toBe('{count} تقاطعًا فارغًا · الدور: {color}')
    expect(catalog['board.scoreForecastMover']).toBe('· بالنسبة إلى {color}: {delta}')
    expect(catalog['board.unreported']).toBe('غير مذكور')
    expect(catalog['board.noPassMap']).toContain('خريطة لتوقع السيطرة')
    expect(catalog['board.noMoveMap']).toContain('خريطة لتوقع السيطرة')
  })

  it('keeps Korean delegation authority with the learner after the delegated move', () => {
    const catalog = messagesForLocale('ko')

    expect(catalog['status.katagoReady']).toBe('KataGo 준비 완료')
    expect(catalog['hero.youLantern']).toBe('나 + 랜턴')
    expect(catalog['doctrine.companionText']).toBe(
      '랜턴은 묻고 설명하며 함께 되짚어 봅니다. 모든 차례의 선택권은 계속 학습자에게 있습니다.',
    )
    expect(catalog['coach.authorityCompanion']).toBe(
      '랜턴은 학습자 편이지만, 한 수를 명시적으로 맡기지 않는 한 돌을 놓지 않습니다.',
    )
    expect(catalog['coach.intention']).toBe('나의 의도')
    expect(catalog['coach.delegationExplanation']).toBe(
      '명시적으로 권한을 부여하면 랜턴은 서버가 제공하고 현재 국면에 연결된 검증된 후보 중에서 선택합니다. 랜턴은 착수하지 않는 동반자로 남으며, 이후의 모든 차례는 계속 학습자에게 있습니다.',
    )
    expect(catalog['coach.delegationExplanation']).not.toContain('동반자로 유지됩니다')
    expect(catalog['chronicle.eyebrow']).toBe('나의 대국 기록')
    expect(catalog['chronicle.unavailableText']).toBe(
      '대국은 샘플 데이터로 대체되지 않았습니다. 로컬 서비스를 다시 연결하고 다시 시도하세요.',
    )
    expect(catalog['chronicle.currentStillHere']).toBe('현재 대국 기록은 그대로 남아 있습니다.')
    expect(catalog['energy.title']).toBe('명확한 레이어 하나를 켜거나 끕니다.')
    expect(catalog['board.unreported']).toBe('보고되지 않음')
  })

  it('keeps Russian identity, turn, rank, map, atari, and ARIA meanings precise', () => {
    const catalog = messagesForLocale('ru')

    expect(catalog['status.katagoReady']).toBe('KataGo готов')
    expect(catalog['hero.localFirst']).toBe('Сначала локальная обработка')
    expect(catalog['hero.youLantern']).toBe('Вы + Фонарь')
    expect(catalog['coach.you']).toBe('Вы')
    expect(catalog['play.toPlay']).toBe('Ход: {name}')
    expect(catalog['play.notLegal']).toBe('Недопустимо')
    expect(catalog['candidate.rank']).toBe('KataGo ставит {coordinate} на место №{rank}{visits}.')
    expect(catalog['candidate.boardField']).toBe('Обзор доски')
    expect(catalog['lens.atari']).toBe('Гипотетическое последствие атари')
    expect(catalog['board.grid']).toBe('Доска вэйци {size}×{size}. Цвет хода: {color}.')
    expect(catalog['board.stone']).toBe('{coordinate}, камень: {color}{last}')
    expect(catalog['board.empty']).toBe('{coordinate}, пустой пункт{selected}')
    expect(catalog['board.black']).toBe('Чёрный')
    expect(catalog['board.white']).toBe('Белый')
    expect(catalog['board.ifPlays']).toBe('Если {color} ставит камень на {coordinate}')
    expect(catalog['board.unreported']).toBe('не указано')
    expect(catalog['board.noPassMap']).toMatch(/^Карта прогноза владения/)
    expect(catalog['board.noMoveMap']).toMatch(/^Карта прогноза владения/)
  })

  it('keeps Vietnamese Go, engine-comparison, and control-map terminology specific', () => {
    const catalog = messagesForLocale('vi')

    expect(catalogText('vi')).not.toMatch(/(?:Trò chơi|trò chơi)/)
    expect(catalog['notice.openFailed']).toBe('Không thể mở ván cờ đó: {detail}')
    expect(catalog['simple.fullGame']).toBe('Ván cờ hoàn chỉnh')
    expect(catalog['hero.quietGame']).toBe('Ván cờ yên tĩnh')
    expect(catalog['play.gameComplete']).toBe('Ván cờ hoàn tất')
    expect(catalog['play.toPlay']).toBe('Lượt của {name}')
    expect(catalog['play.analysisFirst']).toBe('Phân tích trước · việc đặt quân vẫn bị khóa')
    expect(catalog['coach.delegationExplanation']).toBe(
      'Theo ủy quyền rõ ràng của bạn, Đèn lồng sẽ chọn trong các nước ứng viên do máy chủ xác minh và gắn với thế cờ hiện tại. Đèn lồng vẫn là người đồng hành không trực tiếp chơi, và mọi lượt sau vẫn thuộc về bạn.',
    )
    expect(catalog['candidate.boardField']).toBe('Chế độ xem bàn cờ')
    expect(catalog['candidate.smallBoardHidden']).toBe(
      'So sánh của bộ máy phân tích bị ẩn: bài học {size}×{size} này là chế độ xem giảng dạy soạn sẵn.',
    )
    expect(catalog['board.sideText']).toBe('kết nối các quân gần đó')
    expect(catalog['board.noPassMap']).toContain('bản đồ dự báo kiểm soát')
    expect(catalog['board.noMoveMap']).toContain('bản đồ dự báo kiểm soát')
    expect(catalog['chronicle.title']).toContain('Các ván cờ')
    expect(catalog['chronicle.emptyTitle']).toContain('Ván cờ đầu tiên')
    expect(catalog['chronicle.selectGame']).toBe('Chọn một ván cờ')
  })

  it('keeps the breath metaphor distinct from exact liberties in CJK and Vietnamese', () => {
    expect(messagesForLocale('ko')['lens.breath']).toBe('호흡')
    expect(messagesForLocale('ko')['lens.liberties']).toBe('활로')
    expect(messagesForLocale('vi')['lens.breath']).toBe('Hơi thở')
    expect(messagesForLocale('vi')['lens.liberties']).toBe('khí')
    expect(messagesForLocale('zh-Hant')['lens.breath']).toBe('呼吸')
    expect(messagesForLocale('zh-Hant')['lens.liberties']).toBe('氣')
    expect(messagesForLocale('zh-Hans')['lens.breath']).toBe('呼吸')
    expect(messagesForLocale('zh-Hans')['lens.liberties']).toBe('气')
  })
})
