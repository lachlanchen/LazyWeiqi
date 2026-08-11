import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import arCatalog from './locales/ar.json'
import deCatalog from './locales/de.json'
import esCatalog from './locales/es.json'
import frCatalog from './locales/fr.json'
import koCatalog from './locales/ko.json'
import ruCatalog from './locales/ru.json'
import viCatalog from './locales/vi.json'
import zhHantCatalog from './locales/zh-Hant.json'
import {
  isAuthoredLocale,
  localizeAuthoredTemplate,
  localizeAuthoredText,
  type AuthoredLocale,
} from './authoredCopy'
import {
  deterministicActsAdditional,
  knownNamesAdditional,
  lessonTranslationsAdditional,
} from './lessonTranslations.additional'
import type {
  CandidateMove,
  CurriculumResponse,
  EnergyFacet,
  GameState,
  GameSummary,
  LessonSummary,
  MovePreview,
  MoveTeachingEvidence,
} from './types'

export const SUPPORTED_LOCALES = ['en', 'ar', 'es', 'fr', 'ja', 'ko', 'vi', 'zh-Hans', 'zh-Hant', 'de', 'ru'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
type TeachingLocale = AuthoredLocale

const LOCALE_KEY = 'weiqi.path.locale.v1'

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  vi: 'Tiếng Việt',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  de: 'Deutsch',
  ru: 'Русский',
}

const en = {
  'language.label': 'Language',
  'app.name': 'Path of Influence',
  'app.simpleBoard': 'Simple board',
  'app.tagline': 'Weiqi, taught as a living story',
  'nav.simple': 'Simple navigation',
  'nav.primary': 'Primary navigation',
  'nav.start': 'Start',
  'nav.journey': 'Journey',
  'nav.board': 'Board',
  'nav.history': 'History',
  'nav.chronicle': 'Chronicle',
  'nav.newLesson': 'New lesson',
  'nav.currentBoard': 'Current board',
  'nav.gameHistory': 'Game history',
  'nav.fullGuide': 'Full guide',
  'nav.simpleView': 'Simple view',
  'nav.home': 'Path of Influence home',
  'nav.simpleHome': 'Path of Influence simple home',
  'nav.openFull': 'Open the full learning view',
  'nav.openSimple': 'Open the simple full-screen view',
  'nav.toggle': 'Toggle navigation',
  'status.starting': 'Starting',
  'status.engineReady': 'Engine ready',
  'status.katagoReady': 'KataGo ready',
  'status.fallback': 'Fallback',
  'status.unavailable': 'Unavailable',
  'status.lessonFallback': 'Lesson fallback',
  'status.analysisStarting': 'Local analysis engine starting',
  'status.analysisReady': 'KataGo analysis engine ready',
  'status.authoredFallback': 'Using authored lesson fallback',
  'status.authoredGuidance': 'Authored guidance',
  'status.providerReady': '{provider} · ready',
  'status.providerFallback': '{provider} · local fallback',
  'status.providerState': '{provider} · {state}',
  'action.coordinates': 'Toggle board coordinates',
  'action.tryAgain': 'Try again',
  'action.dismiss': 'Dismiss notice',
  'notice.authoredPreview': 'The app is showing its authored lesson preview while the local teaching service starts.',
  'notice.analysisUnavailable': 'Next-move comparison is unavailable. {detail}',
  'notice.olderGamesFailed': 'Older games could not be loaded. {detail}',
  'notice.earlierConversationFailed': 'Earlier conversation could not be loaded. {detail}',
  'notice.localRulesRequired': 'The local rules service must be connected before any agent can place a stone.',
  'notice.delegationUnavailable': 'This position does not have a Human turn and Companion available for one-move delegation.',
  'notice.commitOffline': 'Reconnect the deterministic rules service to commit a move. The current board is a safe preview.',
  'notice.noMoveToRewind': 'There is no committed server move to rewind yet.',
  'notice.openFailed': 'That game could not be opened: {detail}',
  'notice.resumeFailed': 'That game could not be resumed: {detail}',
  'notice.flowInterrupted': 'Something interrupted the teaching flow.',
  'notice.previewFallbackSuffix': 'Showing a non-committing authored preview.',
  'notice.historyPageRepeated': 'The teaching service repeated the same history page.',
  'notice.conversationPageRepeated': 'The teaching service repeated the same conversation page.',
  'notice.previewMismatch': 'The preview no longer matches this board position. Please select the point again.',
  'simple.kicker': 'Clear board · focused teaching',
  'simple.chooseLesson': 'Choose a first lesson',
  'simple.beginSmall': 'Begin on a small board and learn one relationship at a time.',
  'simple.boardSize': 'Board size',
  'simple.firstBreath': 'First breath',
  'simple.shape': 'Shape',
  'simple.fullGame': 'Full game',
  'simple.opening': 'Opening…',
  'simple.openBoard': 'Open the board',
  'simple.lessonFacts': 'Lesson facts',
  'simple.minutes': '{count} min',
  'simple.trainingPosition': 'Training position',
  'simple.chineseRules': 'Chinese area rules',
  'simple.safePreview': 'Safe preview available',
  'simple.connected': 'Local service connected',
  'simple.howMoves': 'How this game moves',
  'simple.chooseStyle': 'Choose your teaching style',
  'simple.remembered': 'Your choice is remembered. You can return here without losing the game.',
  'simple.safety': 'You inspect first. A stone is placed only after the rules preview and your confirmation.',
  'hero.kicker': 'A patient path into Weiqi',
  'hero.title': 'Don’t memorize the board.',
  'hero.titleEm': 'Learn to feel what changes.',
  'hero.description': 'Play a complete game as a story of breath, connection, reach, danger, and choice—grounded in exact rules and bounded local analysis.',
  'hero.continue': 'Continue',
  'hero.begin': 'Begin',
  'hero.beginJourney': 'Begin the journey',
  'hero.seeTeaching': 'See how teaching works',
  'hero.youPlace': 'You place your stones',
  'hero.defaultBoard': '9×9 default',
  'hero.localFirst': 'Local-first',
  'hero.previewReady': 'Preview ready while engine starts',
  'hero.illustration': 'Illustration of a teaching position',
  'hero.lanternAsks': 'Lantern asks',
  'hero.breathQuestion': 'Which group needs breath first?',
  'hero.exactLiberties': 'Exact · Liberties',
  'hero.threeRoads': 'Three open roads',
  'hero.youLantern': 'You + Lantern',
  'hero.narratedTheatre': 'Narrated theatre',
  'hero.quietGame': 'Quiet game',
  'doctrine.eyebrow': 'Our teaching promise',
  'doctrine.title': 'High-quality analysis, honestly labeled',
  'doctrine.description': '“Energy” is a useful language for relationships—not a mystical score and never a replacement for evidence.',
  'doctrine.exactTitle': 'Exact breath',
  'doctrine.exactText': 'Rules code owns liberties, legality, capture, ko, scoring, and history.',
  'doctrine.engineTitle': 'Bounded evidence',
  'doctrine.engineText': 'KataGo supplies candidate forecasts and variation across searched lines. It never mutates a game.',
  'doctrine.companionTitle': 'A companion, not a pilot',
  'doctrine.companionText': 'Lantern asks, explains, and reflects. Your turn remains yours.',
  'doctrine.storyTitle': 'A story you can replay',
  'doctrine.storyText': 'Every rewind becomes a branch, so curiosity never erases the original game.',
  'campaign.eyebrow': 'Your learning path',
  'campaign.title': 'Begin small. Reach the full valley.',
  'campaign.description': 'Short lessons teach one relationship at a time. Nine by nine is the default home for complete games.',
  'campaign.boardSize': 'Lesson board size',
  'campaign.fullJourney': 'Full journey',
  'campaign.firstBreaths': 'First breaths',
  'campaign.growingShape': 'Growing shape',
  'campaign.trainingRules': 'Training rules',
  'campaign.revisit': 'Revisit',
  'campaign.continue': 'Continue',
  'campaign.begin': 'Begin',
  'campaign.moreSoon': 'More lessons are being prepared for this board.',
  'mode.eyebrow': 'Choose how the story moves',
  'mode.title': 'Three ways to learn',
  'mode.description': 'Player Agents may choose only verified legal candidates. Companion and narrator roles never control a color.',
  'mode.group': 'Learning mode',
  'mode.companionTitle': 'Journey with a companion',
  'mode.recommended': 'Recommended',
  'mode.companionDescription': 'You play every stone. Lantern asks questions and explains verified evidence.',
  'mode.humanTitle': 'Quiet teaching game',
  'mode.humanEyebrow': 'Human vs Agent',
  'mode.humanDescription': 'You face a calibrated Player Agent with only concise lesson prompts.',
  'mode.theatreTitle': 'Theatre of stones',
  'mode.theatreEyebrow': 'Narrated Agent vs Agent',
  'mode.theatreDescription': 'Watch two doctrines choose among verified candidates while a narrator teaches.',
  'mode.cast': 'Cast & doctrine',
  'mode.blackMountain': 'Black · Mountain',
  'mode.whiteRiver': 'White · River',
  'mode.opponentRiver': 'Opponent · River',
  'mode.lanternCompanion': 'Lantern · Companion',
  'mode.narratorAuthority': 'Lantern narrates intentions and consequences; it never chooses either side’s move.',
  'doctrine.balanced': 'Balanced',
  'doctrine.territory': 'Territory',
  'doctrine.influence': 'Influence',
  'doctrine.fighting': 'Fighting',
  'doctrine.light': 'Light & flexible',
  'style.socratic': 'Socratic questions',
  'style.encouraging': 'Warm encouragement',
  'style.concise': 'Quiet and concise',
  'play.trainingFocus': 'Training focus:',
  'play.training.firstCapture': 'look for the first sound capture; completion follows the service-reported game state.',
  'play.training.guided': 'this scene begins from an authored teaching position; the live service still owns legality and completion.',
  'play.training.wall': 'practice extending from the wall; the live service remains the authority on legal play and completion.',
  'play.sceneComplete': 'Scene complete',
  'play.endedPasses': 'Play ended · two consecutive passes',
  'play.openReflection': 'Open reflection',
  'play.teachingGame': 'Teaching game',
  'play.moves': '{count} moves',
  'play.move': 'Move {count}',
  'play.gameComplete': 'Game complete',
  'play.scoreNotSettled': 'Play ended · score not settled',
  'play.toPlay': '{name} to play',
  'play.currentPurpose': 'Current purpose',
  'play.komi': 'Komi {value}',
  'play.analyzingAt': 'Analyzing if {color} plays {coordinate}…',
  'play.findingFirst': 'Finding a suggested first stone…',
  'play.comparing': 'Comparing the next choices…',
  'play.backSuggestions': 'Back to suggestions',
  'play.rewind': 'Rewind',
  'play.pauseTheatre': 'Pause theatre',
  'play.watch': 'Watch continuously',
  'play.oneTurn': 'Play one narrated turn',
  'play.cancel': 'Cancel',
  'play.previewHint': 'Previewing · right-click board or Esc to unselect',
  'play.verified': 'Verified',
  'play.notLegal': 'Not legal',
  'play.checking': 'Checking…',
  'play.placeStone': 'Place stone',
  'play.chooseAnother': 'Choose another point',
  'play.analysisFirst': 'Analysis first · placement remains locked',
  'play.candidatePinned': 'Candidate pinned · right-click board or press Esc to return to agent suggestions.',
  'play.selectEmpty': 'Select an empty intersection to preview its consequences.',
  'play.pass': 'Pass',
  'play.resign': 'Resign',
  'play.timeline': 'Move timeline',
  'play.storySoFar': 'The story so far',
  'play.firstChronicle': 'The first move will begin the chronicle.',
  'play.areaUnsettled': 'Territory and dead stones are not settled, so no final score is declared.',
  'play.areaStones': 'Stones: Black {black} · White {white}. Territory and dead stones are not settled, so no final score is declared.',
  'rules.positionalSuperko': 'Positional superko',
  'rules.situationalSuperko': 'Situational superko',
  'rules.simpleKo': 'Simple ko',
  'rules.reasonOccupied': 'that intersection is occupied',
  'rules.reasonSuicide': 'a move cannot leave its own group without liberties',
  'rules.reasonSuperko': 'the move would repeat an earlier board position',
  'rules.reasonFinished': 'the game is already finished',
  'rules.reasonOutside': 'that intersection is outside the {size} board',
  'operation.ready': 'Ready',
  'operation.creating': 'Opening the lesson…',
  'operation.previewing': 'Reading the point…',
  'operation.moving': 'Verifying and placing…',
  'operation.agent': 'Agent is choosing among verified candidates…',
  'operation.coach': 'Companion is preparing a grounded explanation…',
  'operation.rewinding': 'Opening a new branch…',
  'operation.loadingGame': 'Opening the chronicle…',
  'coach.narrator': 'Narrator',
  'coach.lantern': 'Lantern',
  'coach.companion': 'Companion',
  'coach.lessonGuide': 'Lesson guide',
  'coach.compass': 'Compass',
  'coach.authority': 'Agent authority',
  'coach.authorityTheatre': 'Narration explains both doctrines. Only the two Player Agents can place stones.',
  'coach.authorityCompanion': 'Lantern is on your side, but does not move your stones unless you explicitly delegate one turn.',
  'coach.authorityHuman': 'River chooses only among legal candidates verified by the teaching service.',
  'coach.intention': 'Your intention',
  'coach.optional': 'Optional, but useful',
  'coach.moveIntention': 'Move intention',
  'intent.unsure': 'Unsure',
  'intent.claim': 'Claim',
  'intent.connect': 'Connect',
  'intent.pressure': 'Pressure',
  'intent.escape': 'Escape',
  'intent.settle': 'Settle',
  'intent.sacrifice': 'Trade',
  'intent.cut': 'Cut',
  'intent.invade': 'Invade',
  'intent.reduce': 'Reduce',
  'intent.endgame': 'Endgame',
  'coach.revealHistory': 'Reveal conversation history',
  'coach.loadingEarlier': 'Loading earlier messages…',
  'coach.tryEarlier': 'Try loading earlier messages again',
  'coach.loadEarlier': 'Load earlier messages',
  'coach.recentOnly': 'Show recent only',
  'coach.visibleStillHere': 'The visible conversation is still here.',
  'coach.conversation': '{name} conversation',
  'coach.answer': 'Coach answer',
  'coach.companionAnswer': 'Companion answer',
  'coach.narratorResponse': 'Narrator response',
  'coach.systemMessage': 'System message',
  'coach.learnerQuestion': 'Learner question',
  'coach.questionAndAnswer': 'Learner question and {answer}',
  'coach.you': 'You',
  'coach.evidence': 'Evidence provenance',
  'coach.asks': '{name} asks:',
  'coach.empty': 'The guide is watching quietly. Select a point or ask a question.',
  'coach.otherCandidates': 'Other candidate ideas',
  'coach.candidateIntentions': 'Candidate intentions',
  'coach.previewShown': '{coordinate} preview shown on board',
  'coach.pointIllegal': '{coordinate} is not legal',
  'coach.notLegalNow': 'That point is not legal now.',
  'coach.hint': 'Hint ladder',
  'coach.compare': 'Compare',
  'coach.hintQuestion': 'What should I notice before I move?',
  'coach.compareQuestion': 'Explain the strongest contrast between these candidates.',
  'coach.ask': 'Ask the coach',
  'coach.askDoctrine': 'Ask about either doctrine…',
  'coach.askChanged': 'Ask what changed…',
  'coach.invite': 'Invite Lantern to choose this one move',
  'coach.confirmDelegation': 'Confirm one-turn delegation',
  'coach.oneTurnOnly': 'One turn only.',
  'coach.delegationExplanation': 'Under your explicit authority, Lantern will choose from the server’s position-bound verified candidates. Lantern remains a non-playing Companion, and every later turn stays yours.',
  'coach.keepTurn': 'Keep my turn',
  'coach.chooseOnce': 'Choose this move once',
  'candidate.empty': 'Select an empty point to compare its consequences.',
  'candidate.list': 'Candidate move comparison',
  'candidate.suggested': 'Suggested first stone',
  'candidate.engineOrder': 'KataGo order {rank}',
  'candidate.engineRanked': 'KataGo-ranked',
  'candidate.inspectAria': '{prefix}{coordinate}, {title}. Inspect this candidate; click or press Enter to select its non-committing move preview.',
  'candidate.rulesLegal': 'Rules-legal server candidate',
  'candidate.suggestedBadge': 'Suggested first stone · {source}',
  'candidate.teacherFallback': 'teacher fallback',
  'candidate.intentProvenance': 'Teacher hypothesis · possible job',
  'candidate.replyEngine': 'Reply in one engine line (not forced)',
  'candidate.replyExamine': 'Reply to examine',
  'candidate.risk': 'Risk:',
  'candidate.noEngine': 'No engine support is claimed.',
  'candidate.why': 'Why here',
  'candidate.changes': 'What changes',
  'candidate.next': 'Next calculation',
  'candidate.teacherInterpretation': 'Teacher interpretation',
  'candidate.rulesFacts': 'Rules facts',
  'candidate.exact': 'Exact',
  'candidate.scoreComparison': 'Score forecast comparison',
  'candidate.enginePerspective': 'Engine estimate · {color} perspective',
  'candidate.rank': 'KataGo ranks {coordinate} #{rank}{visits}. ',
  'candidate.visits': '; this child received {count} visits',
  'candidate.supportsComparison': 'This supports comparison; it is not a territory fact.',
  'candidate.boardField': 'Board field',
  'candidate.afterOwnership': 'After-move ownership',
  'candidate.deltaOwnership': 'Δ ownership shape',
  'candidate.variationSupplied': 'Black-positive engine estimate; variation across searched continuations is shown cell by cell.',
  'candidate.variationMissing': 'Black-positive engine estimate; no continuation-variation map was supplied, so no stability claim is made.',
  'candidate.smallBoardHidden': 'Engine comparison is hidden: this {size}×{size} lesson is an authored teaching view.',
  'candidate.readNext': 'Read next',
  'candidate.interaction': 'Hover or focus to inspect. Tap, click, or press Enter to keep a non-committing preview. Right-click the board or press Esc to return to agent suggestions.',
  'evidence.exact': 'Exact',
  'evidence.tactical': 'Tactical read',
  'evidence.engine': 'Engine estimate',
  'evidence.model': 'Model explanation',
  'evidence.teacher': 'Teacher guidance',
  'evidence.metaphor': 'Metaphor',
  'energy.views': 'Board views',
  'energy.title': 'Turn one clear layer on or off',
  'energy.noMagic': 'No magic score',
  'energy.overlays': 'Board teaching overlays',
  'energy.noReading': '{term} has no position-bound reading yet',
  'energy.ifPlayed': 'If played',
  'energy.current': 'Current position',
  'lens.cloud': 'Presence sketch',
  'lens.cloudTerm': 'Distance analogy',
  'lens.breath': 'Breath',
  'lens.liberties': 'Liberties',
  'lens.bonds': 'Bonds',
  'lens.connections': 'Connections',
  'lens.shelter': 'Shelter',
  'lens.eyeSpace': 'Eye space',
  'lens.forecast': 'Forecast',
  'lens.ownership': 'Ownership tendency',
  'lens.strong': 'Strong forecast',
  'lens.threshold': 'Display-only ownership threshold',
  'lens.area': 'Board count',
  'lens.areaTerm': 'Stones and empty intersections',
  'lens.turn': 'Turn',
  'lens.side': 'Side to move',
  'lens.pressure': 'Pressure',
  'lens.atari': 'Hypothetical atari consequence',
  'power.eyebrow': 'Reason through this turn',
  'power.title': 'From choice to next calculation',
  'power.remember': 'Remember:',
  'power.memory': 'exact rules facts, engine forecasts, and teacher interpretation answer different questions. A forecast is not territory already yours.',
  'power.play': 'Play',
  'power.because': 'Because',
  'power.changes': 'Changes',
  'power.opponent': 'Opponent',
  'power.thenCheck': 'Then check',
  'power.principle': 'Principle',
  'source.exactRules': 'Exact rules',
  'source.engine': 'Engine estimate',
  'source.lesson': 'Lesson guidance',
  'source.teacher': 'Teacher interpretation',
  'chronicle.eyebrow': 'Your chronicle',
  'chronicle.title': 'Games become stories you can revisit',
  'chronicle.description': 'History keeps the main line, rewinds, intentions, explanations, and engine provenance together.',
  'chronicle.ended': 'Play ended · score not settled',
  'chronicle.movesPhase': '{count} moves · {phase}',
  'chronicle.phasePlaying': 'playing',
  'chronicle.phaseFinished': 'finished',
  'chronicle.revisit': 'Revisit',
  'chronicle.unavailableTitle': 'History is unavailable right now.',
  'chronicle.unavailableText': 'Your games were not replaced with sample data. Reconnect the local service and try again.',
  'chronicle.emptyTitle': 'Your first game will appear here.',
  'chronicle.emptyText': 'Every finished lesson keeps one moment to remember.',
  'chronicle.loadingOlder': 'Loading older games…',
  'chronicle.tryOlder': 'Try loading older games again',
  'chronicle.loadOlder': 'Load older games',
  'chronicle.currentStillHere': 'Your current chronicle is still here.',
  'chronicle.reviewHall': 'Review hall',
  'chronicle.inProgress': 'Journey in progress',
  'chronicle.promise': 'Promise',
  'chronicle.crisis': 'Crisis',
  'chronicle.resolution': 'Resolution',
  'chronicle.moveConcept': 'Move {count} · {concept}',
  'chronicle.noSummary': 'No game-specific story summary has been recorded yet. The move history remains available without an invented interpretation.',
  'chronicle.selectGame': 'Select a game',
  'chronicle.selectText': 'See its promise, crisis, resolution, and one principle worth carrying forward.',
  'chronicle.recently': 'Recently',
  'board.grid': '{size} by {size} Weiqi board. {color} to play.',
  'board.stone': '{coordinate}, {color} stone{last}',
  'board.empty': '{coordinate}, empty{selected}',
  'board.lastMove': ', last move',
  'board.selected': ', selected for preview',
  'board.black': 'Black',
  'board.white': 'White',
  'board.toPlay': '{color} to play.',
  'board.moveLegal': 'Move is legal.',
  'board.moveIllegal': 'Move is not legal: {reason}.',
  'board.unknownReason': 'unknown reason',
  'board.checkingConsequences': 'Checking consequences.',
  'board.presenceExplanation': 'Beginner presence sketch explanation',
  'board.openingSketch': 'Opening efficiency sketch',
  'board.distanceSketch': 'Current-stone distance sketch',
  'board.analogy': 'Beginner analogy · not move quality',
  'board.corner': 'Corner',
  'board.cornerText': 'fewer directions to close',
  'board.side': 'Side',
  'board.sideText': 'links nearby stones',
  'board.center': 'Center',
  'board.centerText': 'reaches far, encloses slowly',
  'board.nearby': 'nearby presence',
  'board.violet': 'Violet',
  'board.bothClose': 'both are close',
  'board.sketchDisclaimer': 'This beginner sketch only shows distance from current stones. It does not rank candidates and is not physics, territory, ownership, or score.',
  'board.smallBoardDisclaimer': 'This is an authored {size}×{size} teaching view; the installed KataGo evidence is 9×9 only.',
  'board.separateEstimate': 'The separate square wash is a KataGo ownership estimate.',
  'board.currentBoard': 'Current board',
  'board.ifPlays': 'If {color} plays {coordinate}',
  'board.stoneCount': 'Stones · Black {black} · White {white}',
  'board.emptyTurn': '{count} empty intersections · {color} to move',
  'board.noTerritory': 'No territory is settled during live play. Use the labeled ownership cloud and score forecast above to compare likely future control.',
  'board.noSmallBoardMap': 'No KataGo map is claimed for this authored {size}×{size} lesson. The ghost stone shows location only.',
  'board.noPassMap': 'No after-pass ownership field was supplied. Pass places no stone; no quality shape is invented.',
  'board.noMoveMap': 'No after-move ownership field was supplied. The ghost stone shows location only; no quality shape is invented.',
  'board.passEnds': 'This second consecutive pass places no stone, captures nothing, and ends play.',
  'board.passContinues': 'Pass places no stone or captures; the opponent moves next, and another consecutive pass ends play.',
  'board.tacticsFacts': '{captures} captures · {liberties} resulting liberties · {connections} connection anchors · {cuts} cut anchors',
  'board.unreported': 'unreported',
  'board.teacherWeather': 'Use the wash like a weather forecast, not a force field. Liberties, connections, threats, and replies are the causes.',
  'board.engineLine': 'Numbered stones show one searched line, not a forced reply.',
  'board.scoreForecastBlack': 'Score forecast · Black perspective',
  'board.scoreForecastValues': 'Before {before} → if played {after} · search difference {delta}',
  'board.scoreForecastMover': ' · for {color} {delta}',
  'board.ownershipDisclaimerWithVariation': 'Ownership colors are a forecast, not territory already secured. The delta layer shows only the strongest changes above its display cutoff; omitted cells are not neutral. Cell variation describes spread across searched continuations. On the delta wash, that spread belongs to the after-position, not to the subtraction itself. Values are always Black perspective, including when White is to play.',
  'board.ownershipDisclaimerNoVariation': 'Ownership colors are a forecast, not territory already secured. The delta layer shows only the strongest changes above its display cutoff; omitted cells are not neutral. No continuation-variation map was supplied, so gray marks unknown variation and no stability claim is made. Values are always Black perspective, including when White is to play.',
  'board.passOverlayDisclaimer': 'This pass preview shows exact turn consequences but no stone location. It invents no ownership shape or territory map; any separate rank or score evidence remains separately labeled.',
  'board.locationOverlayDisclaimer': 'This board overlay shows only the proposed location and exact rules facts. It invents no ownership shape or territory map; any separate rank or score evidence remains separately labeled.',
  'board.nothingPlaced': 'Nothing has been placed.',
} as const

export type MessageKey = keyof typeof en
type Catalog = Record<MessageKey, string>

// Translators intentionally cover interface and reviewed authored teaching copy.
// Unconstrained model/engine prose is rendered verbatim and never passed here.
const zhHans: Catalog = {
  'nav.home': '形势之路首页', 'nav.simpleHome': '形势之路简洁首页', 'nav.openFull': '打开完整学习视图', 'nav.openSimple': '打开简洁全屏视图', 'nav.toggle': '切换导航',
  'status.analysisStarting': '本地分析引擎正在启动', 'status.analysisReady': 'KataGo 分析引擎已就绪', 'status.authoredFallback': '正在使用编写课程备用内容', 'status.authoredGuidance': '编写课程指导', 'status.providerReady': '{provider} · 已就绪', 'status.providerFallback': '{provider} · 本地备用', 'status.providerState': '{provider} · {state}',
  'notice.authoredPreview': '本地教学服务启动时，应用会显示编写好的课程预览。', 'notice.analysisUnavailable': '暂时无法比较下一手。{detail}', 'notice.olderGamesFailed': '无法加载更早的对局。{detail}', 'notice.earlierConversationFailed': '无法加载更早的对话。{detail}', 'notice.localRulesRequired': '智能体落子前必须连接本地规则服务。', 'notice.delegationUnavailable': '当前局面没有可委托一手的人类回合与陪伴者。', 'notice.commitOffline': '请重新连接确定性规则服务后再落子；当前棋盘只是安全预览。', 'notice.noMoveToRewind': '目前没有已提交的服务器着法可供回退。', 'notice.openFailed': '无法打开这局棋：{detail}', 'notice.resumeFailed': '无法继续这局棋：{detail}', 'notice.flowInterrupted': '教学流程遇到了中断。', 'notice.previewFallbackSuffix': '正在显示不会落子的编写课程预览。', 'notice.historyPageRepeated': '教学服务重复返回了同一页对局历史。', 'notice.conversationPageRepeated': '教学服务重复返回了同一页对话。', 'notice.previewMismatch': '预览已不再对应当前棋盘局面，请重新选择该点。',
  'hero.illustration': '教学局面插图',
  'doctrine.eyebrow': '我们的教学承诺', 'doctrine.title': '高质量分析，清楚标明依据', 'doctrine.description': '“能量”是描述关系的实用语言，不是神秘分数，也绝不替代证据。', 'doctrine.exactTitle': '确定的气', 'doctrine.exactText': '规则代码负责气、合法性、提子、劫、计分与历史。', 'doctrine.engineTitle': '有边界的依据', 'doctrine.engineText': 'KataGo 提供候选预测与搜索变化，但绝不直接改变棋局。', 'doctrine.companionTitle': '陪伴者，不是代驾', 'doctrine.companionText': '灯笼会提问、解释和复盘；你的回合始终属于你。', 'doctrine.storyTitle': '可反复查看的故事', 'doctrine.storyText': '每次回退都会成为分支，因此探索不会抹去原来的棋局。',
  'play.training.firstCapture': '寻找第一次稳妥的提子；是否完成以服务报告的对局状态为准。', 'play.training.guided': '本场景从编写的教学局面开始；合法性与完成状态仍由实时服务决定。', 'play.training.wall': '练习从厚壁向外延伸；合法着法与完成状态仍以实时服务为准。', 'play.areaStones': '棋子：黑 {black} · 白 {white}。地盘与死子尚未确定，因此不宣布最终比分。',
  'operation.ready': '就绪', 'operation.creating': '正在打开课程…', 'operation.previewing': '正在读取此点…', 'operation.moving': '正在验证并落子…', 'operation.agent': '智能体正在从已验证候选中选择…', 'operation.coach': '陪伴者正在准备有依据的解释…', 'operation.rewinding': '正在打开新分支…', 'operation.loadingGame': '正在打开棋谱…',
  'coach.conversation': '与{name}的对话', 'coach.answer': '教练回答', 'coach.companionAnswer': '陪伴者回答', 'coach.narratorResponse': '解说回答', 'coach.systemMessage': '系统消息', 'coach.asks': '{name}问：', 'coach.previewShown': '棋盘上已显示 {coordinate} 的预览', 'coach.pointIllegal': '{coordinate} 不合法', 'coach.confirmDelegation': '确认委托一手', 'coach.delegationExplanation': '在你的明确授权下，灯笼会从服务器提供且与当前局面绑定的已验证候选中选择。灯笼仍是不落子的陪伴者，之后每个回合仍属于你。', 'coach.questionAndAnswer': '学习者提问和{answer}',
  'candidate.engineOrder': 'KataGo 排名第 {rank}', 'candidate.engineRanked': 'KataGo 已排名', 'candidate.inspectAria': '{prefix}{coordinate}，{title}。查看此候选；单击或按 Enter 选择不会落子的着法预览。', 'candidate.rulesLegal': '规则服务验证的合法候选', 'candidate.suggestedBadge': '建议的第一手 · {source}', 'candidate.enginePerspective': '引擎估计 · {color}视角', 'candidate.rank': 'KataGo 将 {coordinate} 排在第 {rank} 位{visits}。', 'candidate.visits': '；该子局面获得 {count} 次访问', 'candidate.variationSupplied': '正值表示黑棋归属的引擎估计；搜索到的不同后续之间的变化会逐格显示。', 'candidate.variationMissing': '正值表示黑棋归属的引擎估计；未提供后续变化图，因此不对稳定性作任何判断。', 'candidate.smallBoardHidden': '引擎比较已隐藏：此 {size}×{size} 课程是编写的教学视图。',
  'energy.noReading': '{term} 尚无与当前局面绑定的读取',
  'chronicle.movesPhase': '{count} 手 · {phase}', 'chronicle.phasePlaying': '进行中', 'chronicle.phaseFinished': '已结束', 'chronicle.currentStillHere': '当前棋谱仍在这里。', 'chronicle.moveConcept': '第 {count} 手 · {concept}',
  'board.grid': '{size}×{size} 围棋盘。轮到{color}。', 'board.stone': '{coordinate}，{color}{last}', 'board.empty': '{coordinate}，空点{selected}', 'board.toPlay': '轮到{color}。', 'board.moveIllegal': '着法不合法：{reason}。', 'board.unknownReason': '原因未知', 'board.presenceExplanation': '初学者存在感示意说明', 'board.ifPlays': '如果{color}下在 {coordinate}', 'board.stoneCount': '棋子 · 黑 {black} · 白 {white}', 'board.emptyTurn': '{count} 个空交叉点 · 轮到{color}',
  'board.noSmallBoardMap': '此编写的 {size}×{size} 课程不声称有 KataGo 分布图；虚影棋子只表示位置。', 'board.noPassMap': '未提供停一手后的归属图。停一手不会落子，也不虚构着法质量形状。', 'board.noMoveMap': '未提供着后归属图。虚影棋子只表示位置，不虚构着法质量形状。', 'board.passEnds': '这是连续第二次停一手：不落子、不提子，并结束对局。', 'board.passContinues': '停一手不落子也不提子；轮到对手，再连续停一手就结束对局。', 'board.tacticsFacts': '提 {captures} 子 · 结果有 {liberties} 口气 · {connections} 个连接锚点 · {cuts} 个切断锚点', 'board.unreported': '未报告', 'board.teacherWeather': '把渐变看作天气预报，而不是力场。真正的原因是气、连接、威胁与应手。', 'board.engineLine': '编号棋子只显示一条搜索变化，不是强制应手。', 'board.scoreForecastBlack': '目数预测 · 黑棋视角', 'board.scoreForecastValues': '着前 {before} → 若下此手 {after} · 搜索差值 {delta}', 'board.scoreForecastMover': ' · 对{color} {delta}', 'board.ownershipDisclaimerWithVariation': '归属颜色是预测，不是已确保的地盘。差值层只显示超过阈值的最强变化；未显示的格子不代表中立。逐格变化表示搜索后续之间的分散程度；在差值渐变中，这种分散属于着后局面，而不是减法本身。数值始终以黑棋为视角，即使轮到白棋。', 'board.ownershipDisclaimerNoVariation': '归属颜色是预测，不是已确保的地盘。差值层只显示超过阈值的最强变化；未显示的格子不代表中立。未提供后续变化图，所以灰色表示变化未知，不声称稳定性。数值始终以黑棋为视角，即使轮到白棋。', 'board.passOverlayDisclaimer': '停一手预览只显示确定的回合后果，不显示棋子位置。它不会虚构归属形状或地盘图；排名或目数依据会另行标注。', 'board.locationOverlayDisclaimer': '此棋盘图层只显示拟下位置与确定规则事实。它不会虚构归属形状或地盘图；排名或目数依据会另行标注。', 'board.nothingPlaced': '尚未落子。',
  'language.label': '语言', 'app.name': '形势之路', 'app.simpleBoard': '简洁棋盘', 'app.tagline': '在生动的对局中学围棋',
  'nav.simple': '简洁导航', 'nav.primary': '主导航', 'nav.start': '开始', 'nav.journey': '学习', 'nav.board': '棋盘', 'nav.history': '历史', 'nav.chronicle': '棋谱', 'nav.newLesson': '新课', 'nav.currentBoard': '当前棋盘', 'nav.gameHistory': '对局历史', 'nav.fullGuide': '完整指导', 'nav.simpleView': '简洁视图',
  'status.starting': '启动中', 'status.engineReady': '引擎已就绪', 'status.katagoReady': 'KataGo 已就绪', 'status.fallback': '备用模式', 'status.unavailable': '不可用', 'status.lessonFallback': '课程备用模式', 'action.coordinates': '切换棋盘坐标', 'action.tryAgain': '重试', 'action.dismiss': '关闭提示',
  'simple.kicker': '清爽棋盘 · 专注教学', 'simple.chooseLesson': '选择第一课', 'simple.beginSmall': '从小棋盘开始，一次理解一种关系。', 'simple.boardSize': '棋盘大小', 'simple.firstBreath': '第一口气', 'simple.shape': '棋形', 'simple.fullGame': '完整对局', 'simple.opening': '正在打开…', 'simple.openBoard': '打开棋盘', 'simple.lessonFacts': '课程信息', 'simple.minutes': '{count} 分钟', 'simple.trainingPosition': '练习局面', 'simple.chineseRules': '中国规则数子法', 'simple.safePreview': '可安全预览', 'simple.connected': '本地服务已连接', 'simple.howMoves': '对局如何进行', 'simple.chooseStyle': '选择教学方式', 'simple.remembered': '选择会自动保存；返回此处不会丢失对局。', 'simple.safety': '先观察，再落子。只有规则预览完成且你确认后，棋子才会真正落下。',
  'hero.kicker': '耐心走进围棋', 'hero.title': '不要死记棋盘。', 'hero.titleEm': '学会感受什么改变了。', 'hero.description': '把完整对局理解为气、连接、影响、危险与选择的故事，并以确定规则和有边界的本地分析为依据。', 'hero.continue': '继续', 'hero.begin': '开始', 'hero.beginJourney': '开始学习', 'hero.seeTeaching': '了解教学方式', 'hero.youPlace': '每颗棋子由你落下', 'hero.defaultBoard': '默认 9×9', 'hero.localFirst': '本地优先', 'hero.previewReady': '引擎启动时仍可预览', 'hero.lanternAsks': '灯笼问', 'hero.breathQuestion': '哪块棋最需要先补气？', 'hero.exactLiberties': '确定事实 · 气', 'hero.threeRoads': '三口气', 'hero.youLantern': '你 + 灯笼', 'hero.narratedTheatre': '讲解对弈', 'hero.quietGame': '安静对局',
  'campaign.eyebrow': '你的学习路径', 'campaign.title': '从小处开始，走向完整棋局。', 'campaign.description': '短课程每次只教一种关系；9×9 是完整对局的默认棋盘。', 'campaign.boardSize': '课程棋盘大小', 'campaign.fullJourney': '完整旅程', 'campaign.firstBreaths': '初识气', 'campaign.growingShape': '理解棋形', 'campaign.trainingRules': '练习规则', 'campaign.revisit': '重温', 'campaign.continue': '继续', 'campaign.begin': '开始', 'campaign.moreSoon': '正在为这个棋盘准备更多课程。',
  'mode.eyebrow': '选择对局如何进行', 'mode.title': '三种学习方式', 'mode.description': '棋手智能体只能从已验证的合法候选中选择；陪伴者与解说者不控制任何一方。', 'mode.group': '学习模式', 'mode.companionTitle': '与陪伴者同行', 'mode.recommended': '推荐', 'mode.companionDescription': '每一手由你来下；灯笼提问并解释已验证的依据。', 'mode.humanTitle': '安静教学局', 'mode.humanEyebrow': '人类对智能体', 'mode.humanDescription': '与经调校的棋手智能体对弈，只接收简洁课程提示。', 'mode.theatreTitle': '棋子剧场', 'mode.theatreEyebrow': '智能体对弈解说', 'mode.theatreDescription': '观看两种棋风从已验证候选中选择，同时听解说。', 'mode.cast': '角色与棋风', 'mode.blackMountain': '黑棋 · 山', 'mode.whiteRiver': '白棋 · 河', 'mode.opponentRiver': '对手 · 河', 'mode.lanternCompanion': '灯笼 · 陪伴者', 'mode.narratorAuthority': '灯笼只解说意图和后果，不替任何一方选择着法。',
  'doctrine.balanced': '均衡', 'doctrine.territory': '实地', 'doctrine.influence': '外势', 'doctrine.fighting': '战斗', 'doctrine.light': '轻灵', 'style.socratic': '苏格拉底式提问', 'style.encouraging': '温暖鼓励', 'style.concise': '安静简洁',
  'play.trainingFocus': '练习重点：', 'play.sceneComplete': '本局完成', 'play.endedPasses': '对局结束 · 连续两次停一手', 'play.openReflection': '打开复盘', 'play.teachingGame': '教学局', 'play.moves': '{count} 手', 'play.move': '第 {count} 手', 'play.gameComplete': '对局完成', 'play.scoreNotSettled': '对局结束 · 胜负未定', 'play.toPlay': '轮到 {name}', 'play.currentPurpose': '当前目标', 'play.komi': '贴目 {value}', 'play.analyzingAt': '正在分析 {color} 下在 {coordinate} 后的局面…', 'play.findingFirst': '正在寻找建议的第一手…', 'play.comparing': '正在比较下一手选择…', 'play.backSuggestions': '返回建议', 'play.rewind': '悔棋', 'play.pauseTheatre': '暂停对弈', 'play.watch': '连续观看', 'play.oneTurn': '走一手并解说', 'play.cancel': '取消', 'play.previewHint': '预览中 · 右键棋盘或按 Esc 取消选择', 'play.verified': '已验证', 'play.notLegal': '不合法', 'play.checking': '检查中…', 'play.placeStone': '确认落子', 'play.chooseAnother': '选择其他点', 'play.analysisFirst': '先看分析 · 落子仍锁定', 'play.candidatePinned': '已固定候选 · 右键棋盘或按 Esc 返回智能体建议。', 'play.selectEmpty': '选择空交叉点，预览它带来的后果。', 'play.pass': '停一手', 'play.resign': '认输', 'play.timeline': '着法时间线', 'play.storySoFar': '目前的对局', 'play.firstChronicle': '第一手将开启棋谱。', 'play.areaUnsettled': '地盘与死子尚未确定，因此不宣布最终比分。', 'rules.positionalSuperko': '禁全同局', 'rules.situationalSuperko': '禁同局同方', 'rules.simpleKo': '单劫规则', 'rules.reasonOccupied': '该交叉点已有棋子', 'rules.reasonSuicide': '着法不能让自己的棋块没有气', 'rules.reasonSuperko': '这手棋会重复之前的盘面局面', 'rules.reasonFinished': '对局已经结束', 'rules.reasonOutside': '该交叉点位于 {size} 棋盘之外',
  'coach.narrator': '解说者', 'coach.lantern': '灯笼', 'coach.companion': '陪伴者', 'coach.lessonGuide': '课程向导', 'coach.compass': '罗盘', 'coach.authority': '智能体权限', 'coach.authorityTheatre': '解说只说明双方棋风；只有两个棋手智能体能落子。', 'coach.authorityCompanion': '灯笼站在你这边，但不会替你落子，除非你明确委托这一手。', 'coach.authorityHuman': '河只从教学服务已验证的合法候选中选择。', 'coach.intention': '你的意图', 'coach.optional': '可选，但很有帮助', 'coach.moveIntention': '着法意图', 'intent.unsure': '不确定', 'intent.claim': '占地', 'intent.connect': '连接', 'intent.pressure': '施压', 'intent.escape': '逃出', 'intent.settle': '安定', 'intent.sacrifice': '取舍', 'intent.cut': '切断', 'intent.invade': '打入', 'intent.reduce': '消减', 'intent.endgame': '官子', 'coach.revealHistory': '展开对话历史', 'coach.loadingEarlier': '正在加载更早消息…', 'coach.tryEarlier': '重试加载更早消息', 'coach.loadEarlier': '加载更早消息', 'coach.recentOnly': '只显示最近消息', 'coach.visibleStillHere': '当前可见对话仍在。', 'coach.learnerQuestion': '学习者提问', 'coach.you': '你', 'coach.evidence': '依据来源', 'coach.empty': '向导正安静观察。选一个点，或提一个问题。', 'coach.otherCandidates': '其他候选思路', 'coach.candidateIntentions': '候选着法意图', 'coach.notLegalNow': '这个点当前不合法。', 'coach.hint': '分级提示', 'coach.compare': '比较', 'coach.hintQuestion': '我落子前应该先注意什么？', 'coach.compareQuestion': '请解释这些候选着之间最关键的差别。', 'coach.ask': '询问教练', 'coach.askDoctrine': '询问任一方的棋风…', 'coach.askChanged': '询问改变了什么…', 'coach.invite': '邀请灯笼只代下这一手', 'coach.oneTurnOnly': '仅此一手。', 'coach.keepTurn': '保留我的回合', 'coach.chooseOnce': '只代选这一手',
  'candidate.empty': '选择一个空点来比较后果。', 'candidate.list': '候选着法比较', 'candidate.suggested': '建议的第一手', 'candidate.teacherFallback': '教师备用建议', 'candidate.intentProvenance': '教师假设 · 可能任务', 'candidate.replyEngine': '引擎主变中的回应（非必然）', 'candidate.replyExamine': '需检查的回应', 'candidate.risk': '风险：', 'candidate.noEngine': '此处不声称有引擎支持。', 'candidate.why': '为什么下这里', 'candidate.changes': '改变了什么', 'candidate.next': '下一步计算', 'candidate.teacherInterpretation': '教师解读', 'candidate.rulesFacts': '规则事实', 'candidate.exact': '确定', 'candidate.scoreComparison': '目数预测比较', 'candidate.supportsComparison': '这仅用于比较，不是地盘事实。', 'candidate.boardField': '棋盘分布', 'candidate.afterOwnership': '着后归属预测', 'candidate.deltaOwnership': '归属变化形状', 'candidate.readNext': '继续阅读', 'candidate.interaction': '悬停或聚焦以查看。点按、单击或按 Enter 保留不落子的预览；右键棋盘或按 Esc 返回智能体建议。',
  'evidence.exact': '确定事实', 'evidence.tactical': '战术读取', 'evidence.engine': '引擎估计', 'evidence.model': '模型解释', 'evidence.teacher': '教师指导', 'evidence.metaphor': '比喻', 'energy.views': '棋盘视图', 'energy.title': '切换清晰的单个图层', 'energy.noMagic': '没有神秘总分', 'energy.overlays': '棋盘教学图层', 'energy.ifPlayed': '如果下在此处', 'energy.current': '当前局面', 'lens.cloud': '存在感示意', 'lens.cloudTerm': '距离比喻', 'lens.breath': '呼吸', 'lens.liberties': '气', 'lens.bonds': '连结', 'lens.connections': '连接', 'lens.shelter': '安定', 'lens.eyeSpace': '眼位', 'lens.forecast': '预测', 'lens.ownership': '归属倾向', 'lens.strong': '强预测', 'lens.threshold': '仅用于显示的归属阈值', 'lens.area': '盘面计数', 'lens.areaTerm': '棋子与空交叉点', 'lens.turn': '回合', 'lens.side': '轮到哪方', 'lens.pressure': '压力', 'lens.atari': '假设着法造成的叫吃',
  'power.eyebrow': '按逻辑思考这一手', 'power.title': '从选择到下一步计算', 'power.remember': '记住：', 'power.memory': '确定规则事实、引擎预测和教师解读回答的是不同问题。预测不是已属于你的地盘。', 'power.play': '下在哪里', 'power.because': '为什么', 'power.changes': '改变', 'power.opponent': '对手回应', 'power.thenCheck': '然后检查', 'power.principle': '原则', 'source.exactRules': '确定规则', 'source.engine': '引擎估计', 'source.lesson': '课程指导', 'source.teacher': '教师解读',
  'chronicle.eyebrow': '你的棋谱', 'chronicle.title': '对局会成为可重温的故事', 'chronicle.description': '历史把主线、悔棋分支、意图、解释与引擎来源放在一起。', 'chronicle.ended': '对局结束 · 胜负未定', 'chronicle.revisit': '重温', 'chronicle.unavailableTitle': '暂时无法读取历史。', 'chronicle.unavailableText': '你的对局没有被示例数据替换。重新连接本地服务后再试。', 'chronicle.emptyTitle': '第一局棋会出现在这里。', 'chronicle.emptyText': '每个完成的课程都会留下一个值得记住的时刻。', 'chronicle.loadingOlder': '正在加载更早对局…', 'chronicle.tryOlder': '重试加载更早对局', 'chronicle.loadOlder': '加载更早对局', 'chronicle.reviewHall': '复盘室', 'chronicle.inProgress': '对局进行中', 'chronicle.promise': '起意', 'chronicle.crisis': '危机', 'chronicle.resolution': '收束', 'chronicle.noSummary': '尚未记录这局棋的专属故事摘要。着法历史依然完整保留，不会虚构解读。', 'chronicle.selectGame': '选择一局棋', 'chronicle.selectText': '查看它的起意、危机、收束，以及一条值得带走的原则。', 'chronicle.recently': '最近',
  'board.black': '黑棋', 'board.white': '白棋', 'board.lastMove': '，最后一手', 'board.selected': '，已选中预览', 'board.moveLegal': '着法合法。', 'board.checkingConsequences': '正在检查后果。', 'board.openingSketch': '开局效率示意', 'board.distanceSketch': '当前棋子距离示意', 'board.analogy': '初学者比喻 · 不代表着法质量', 'board.corner': '角', 'board.cornerText': '只需关闭较少方向', 'board.side': '边', 'board.sideText': '易与附近棋子联系', 'board.center': '中腹', 'board.centerText': '延伸远，围空慢', 'board.nearby': '附近存在感', 'board.violet': '紫色', 'board.bothClose': '双方都很近', 'board.sketchDisclaimer': '这个初学示意只表示与当前棋子的距离。它不给候选着排名，也不是物理场、地盘、归属或比分。', 'board.smallBoardDisclaimer': '这是人工编写的 {size}×{size} 教学视图；已安装的 KataGo 依据仅适用于 9×9。', 'board.separateEstimate': '另一层方格渐变是 KataGo 的归属估计。', 'board.currentBoard': '当前棋盘', 'board.noTerritory': '对局进行中没有已定地盘。请用上方已标注的归属云图和目数预测比较未来可能的控制。',
}

const ja: Catalog = {
  'nav.home': '影響の道ホーム', 'nav.simpleHome': '影響の道シンプルホーム', 'nav.openFull': '完全な学習表示を開く', 'nav.openSimple': 'シンプル全画面表示を開く', 'nav.toggle': 'ナビゲーションを切り替える',
  'status.analysisStarting': 'ローカル解析エンジンを起動中', 'status.analysisReady': 'KataGo 解析エンジン準備完了', 'status.authoredFallback': '作成済みレッスンの代替を使用中', 'status.authoredGuidance': '作成済みガイド', 'status.providerReady': '{provider} · 準備完了', 'status.providerFallback': '{provider} · ローカル代替', 'status.providerState': '{provider} · {state}',
  'notice.authoredPreview': 'ローカル教学サービスの起動中は、作成済みレッスンのプレビューを表示します。', 'notice.analysisUnavailable': '次の手を比較できません。{detail}', 'notice.olderGamesFailed': '過去の対局を読み込めませんでした。{detail}', 'notice.earlierConversationFailed': '過去の会話を読み込めませんでした。{detail}', 'notice.localRulesRequired': 'エージェントが石を打つには、ローカルルールサービスへの接続が必要です。', 'notice.delegationUnavailable': 'この局面には、1 手を委譲できる人間の手番とコンパニオンがありません。', 'notice.commitOffline': '着手するには決定論的ルールサービスへ再接続してください。現在の盤は安全なプレビューです。', 'notice.noMoveToRewind': 'まだ巻き戻せるサーバー確定手がありません。', 'notice.openFailed': 'この対局を開けませんでした：{detail}', 'notice.resumeFailed': 'この対局を再開できませんでした：{detail}', 'notice.flowInterrupted': '教学の流れが中断されました。', 'notice.previewFallbackSuffix': '着手しない作成済みプレビューを表示しています。', 'notice.historyPageRepeated': '教学サービスが同じ対局履歴ページを繰り返しました。', 'notice.conversationPageRepeated': '教学サービスが同じ会話ページを繰り返しました。', 'notice.previewMismatch': 'プレビューが現在の盤面と一致しなくなりました。この点を選び直してください。',
  'hero.illustration': '教学局面のイラスト',
  'doctrine.eyebrow': '私たちの教学方針', 'doctrine.title': '高品質な解析を、根拠とともに明示', 'doctrine.description': '「エネルギー」は関係を表す便利な言葉です。神秘的な総合点でも、根拠の代わりでもありません。', 'doctrine.exactTitle': '正確な呼吸', 'doctrine.exactText': 'ルールコードが、ダメ、着手の合法性、取り、コウ、得点計算、履歴を管理します。', 'doctrine.engineTitle': '範囲を限定した根拠', 'doctrine.engineText': 'KataGo は候補予測と探索変化を示しますが、対局を直接変更しません。', 'doctrine.companionTitle': '操縦者ではなくコンパニオン', 'doctrine.companionText': 'ランタンは問い、説明し、振り返ります。あなたの手番は常にあなたのものです。', 'doctrine.storyTitle': '何度もたどれる物語', 'doctrine.storyText': '巻き戻すたびに分岐として残るため、好奇心が元の対局を消すことはありません。',
  'play.training.firstCapture': '最初の堅実な取りを探します。完了はサービスが報告する対局状態に従います。', 'play.training.guided': 'この場面は作成済みの教学局面から始まります。合法性と完了はライブサービスが管理します。', 'play.training.wall': '厚い壁から伸びる練習です。合法手と完了はライブサービスが管理します。', 'play.areaStones': '石：黒 {black} · 白 {white}。地と死石が未確定のため、最終得点は宣言しません。',
  'operation.ready': '準備完了', 'operation.creating': 'レッスンを開いています…', 'operation.previewing': 'この点を読んでいます…', 'operation.moving': '検証して着手しています…', 'operation.agent': 'エージェントが検証済み候補から選んでいます…', 'operation.coach': 'コンパニオンが根拠に基づく説明を準備しています…', 'operation.rewinding': '新しい分岐を開いています…', 'operation.loadingGame': '棋譜を開いています…',
  'coach.conversation': '{name}との会話', 'coach.answer': 'コーチの回答', 'coach.companionAnswer': 'コンパニオンの回答', 'coach.narratorResponse': '解説者の回答', 'coach.systemMessage': 'システムメッセージ', 'coach.asks': '{name}からの質問：', 'coach.previewShown': '{coordinate} のプレビューを盤に表示', 'coach.pointIllegal': '{coordinate} は非合法', 'coach.confirmDelegation': '1 手の委譲を確認', 'coach.delegationExplanation': 'あなたの明示的な許可により、ランタンはサーバーが提示した局面固定の検証済み候補から選びます。ランタンは着手しないコンパニオンのままで、その後の手番はすべてあなたに残ります。', 'coach.questionAndAnswer': '学習者の質問と{answer}',
  'candidate.engineOrder': 'KataGo 順位 {rank}', 'candidate.engineRanked': 'KataGo 順位付き', 'candidate.inspectAria': '{prefix}{coordinate}、{title}。この候補を調べます。クリックまたは Enter で着手しないプレビューを選択します。', 'candidate.rulesLegal': 'ルールサービス検証済みの合法候補', 'candidate.suggestedBadge': 'おすすめの第一手 · {source}', 'candidate.enginePerspective': 'エンジン推定 · {color}視点', 'candidate.rank': 'KataGo は {coordinate} を第 {rank} 位と評価しています{visits}。', 'candidate.visits': '（この分岐の訪問回数は {count} 回）', 'candidate.variationSupplied': '正値が黒の帰属を示すエンジン推定です。探索した継続手順ごとのばらつきを各交点に表示します。', 'candidate.variationMissing': '正値が黒の帰属を示すエンジン推定です。継続手順のばらつき図がないため、安定性は主張しません。', 'candidate.smallBoardHidden': 'エンジン比較は非表示です。この {size}×{size} レッスンは作成済みの教学表示です。',
  'energy.noReading': '{term}には、まだ局面に紐付いた読みがありません',
  'chronicle.movesPhase': '{count} 手 · {phase}', 'chronicle.phasePlaying': '対局中', 'chronicle.phaseFinished': '終局', 'chronicle.currentStillHere': '現在の棋譜はそのまま残っています。', 'chronicle.moveConcept': '{count} 手目 · {concept}',
  'board.grid': '{size}×{size} の囲碁盤。{color}の手番です。', 'board.stone': '{coordinate}、{color}の石{last}', 'board.empty': '{coordinate}、空点{selected}', 'board.toPlay': '{color}の手番です。', 'board.moveIllegal': '非合法手です：{reason}。', 'board.unknownReason': '理由不明', 'board.presenceExplanation': '初心者向け存在感スケッチの説明', 'board.ifPlays': '{color}が {coordinate} に打つ場合', 'board.stoneCount': '石 · 黒 {black} · 白 {white}', 'board.emptyTurn': '空点 {count} · {color}の手番',
  'board.noSmallBoardMap': 'この作成済み {size}×{size} レッスンでは KataGo の分布図を主張しません。半透明の石は位置だけを示します。', 'board.noPassMap': 'パス後の帰属図は提供されていません。パスは石を打たず、手の質を表す形も作りません。', 'board.noMoveMap': '着手後の帰属図は提供されていません。半透明の石は位置だけを示し、手の質を表す形は作りません。', 'board.passEnds': '2 回目の連続パスです。石を打たず、取りもなく、終局します。', 'board.passContinues': 'パスは石を打たず、取りもありません。次は相手で、もう 1 回連続パスすると終局します。', 'board.tacticsFacts': '{captures} 子を取る · 結果は {liberties} ダメ · 連絡拠点 {connections} · 切断拠点 {cuts}', 'board.unreported': '未報告', 'board.teacherWeather': '濃淡は力場ではなく天気予報として見ます。原因はダメ、連絡、脅威、応手です。', 'board.engineLine': '番号付きの石は探索変化の一例であり、強制応手ではありません。', 'board.scoreForecastBlack': '得点予測 · 黒視点', 'board.scoreForecastValues': '着手前 {before} → 打った場合 {after} · 探索差 {delta}', 'board.scoreForecastMover': ' · {color}にとって {delta}', 'board.ownershipDisclaimerWithVariation': '帰属色は予測であり、すでに確保した地ではありません。差分層は表示閾値を超えた最も大きな変化だけを示し、省略された交点は中立とは限りません。交点ごとのばらつきは探索した続行間の広がりを表します。差分の濃淡では、そのばらつきは差し引き自体ではなく着手後局面に属します。白番でも数値は常に黒視点です。', 'board.ownershipDisclaimerNoVariation': '帰属色は予測であり、すでに確保した地ではありません。差分層は表示閾値を超えた最も大きな変化だけを示し、省略された交点は中立とは限りません。続行のばらつき図がないため、灰色は不明を表し、安定性は主張しません。白番でも数値は常に黒視点です。', 'board.passOverlayDisclaimer': 'パスのプレビューは正確な手番上の結果だけを示し、石の位置はありません。帰属形状や地の図を作りません。順位や得点の根拠は別に表示します。', 'board.locationOverlayDisclaimer': 'この盤上表示は候補位置と正確なルール事実だけを示します。帰属形状や地の図を作りません。順位や得点の根拠は別に表示します。', 'board.nothingPlaced': 'まだ石は打たれていません。',
  'language.label': '言語', 'app.name': '影響の道', 'app.simpleBoard': 'シンプル盤', 'app.tagline': '生きた物語として学ぶ囲碁',
  'nav.simple': 'シンプルナビ', 'nav.primary': 'メインナビ', 'nav.start': '始める', 'nav.journey': '学習', 'nav.board': '碁盤', 'nav.history': '履歴', 'nav.chronicle': '棋譜', 'nav.newLesson': '新しいレッスン', 'nav.currentBoard': '現在の碁盤', 'nav.gameHistory': '対局履歴', 'nav.fullGuide': '完全ガイド', 'nav.simpleView': 'シンプル表示',
  'status.starting': '起動中', 'status.engineReady': 'エンジン準備完了', 'status.katagoReady': 'KataGo 準備完了', 'status.fallback': '代替モード', 'status.unavailable': '利用不可', 'status.lessonFallback': 'レッスン代替', 'action.coordinates': '盤の座標を切り替える', 'action.tryAgain': '再試行', 'action.dismiss': '通知を閉じる',
  'simple.kicker': 'すっきりした盤 · 集中レッスン', 'simple.chooseLesson': '最初のレッスンを選ぶ', 'simple.beginSmall': '小さな盤から始め、一度に一つの関係を学びます。', 'simple.boardSize': '盤の大きさ', 'simple.firstBreath': '最初の呼吸', 'simple.shape': '形', 'simple.fullGame': '完全対局', 'simple.opening': '開いています…', 'simple.openBoard': '盤を開く', 'simple.lessonFacts': 'レッスン情報', 'simple.minutes': '{count} 分', 'simple.trainingPosition': '練習局面', 'simple.chineseRules': '中国ルールの面積計算', 'simple.safePreview': '安全なプレビュー', 'simple.connected': 'ローカルサービス接続済み', 'simple.howMoves': 'この対局の進め方', 'simple.chooseStyle': '教え方を選ぶ', 'simple.remembered': '選択は保存されます。対局を失わずにここへ戻れます。', 'simple.safety': 'まず調べます。ルールプレビューとあなたの確認後にだけ石を打ちます。',
  'hero.kicker': 'ゆっくり囲碁へ入る道', 'hero.title': '盤を丸暗記しない。', 'hero.titleEm': '何が変わるかを感じ取る。', 'hero.description': '呼吸、つながり、広がり、危険、選択の物語として一局を打ちます。根拠は正確なルールと範囲を限定したローカル解析です。', 'hero.continue': '続ける', 'hero.begin': '始める', 'hero.beginJourney': '学習を始める', 'hero.seeTeaching': '教え方を見る', 'hero.youPlace': '石を打つのはあなた', 'hero.defaultBoard': '標準は 9×9', 'hero.localFirst': 'ローカル優先', 'hero.previewReady': 'エンジン起動中もプレビュー可能', 'hero.lanternAsks': 'ランタンの質問', 'hero.breathQuestion': 'どの石の一団が先に呼吸を必要としている？', 'hero.exactLiberties': '正確 · ダメ', 'hero.threeRoads': '3 つのダメ', 'hero.youLantern': 'あなた + ランタン', 'hero.narratedTheatre': '解説付き観戦', 'hero.quietGame': '静かな対局',
  'campaign.eyebrow': '学習コース', 'campaign.title': '小さく始め、盤全体へ。', 'campaign.description': '短いレッスンで関係を一つずつ学びます。9×9 が完全対局の標準です。', 'campaign.boardSize': 'レッスンの盤サイズ', 'campaign.fullJourney': '完全コース', 'campaign.firstBreaths': '呼吸の基礎', 'campaign.growingShape': '形を育てる', 'campaign.trainingRules': '練習ルール', 'campaign.revisit': '復習', 'campaign.continue': '続ける', 'campaign.begin': '始める', 'campaign.moreSoon': 'この盤向けのレッスンを準備中です。',
  'mode.eyebrow': '物語の進め方', 'mode.title': '3 つの学び方', 'mode.description': '対局エージェントは検証済みの合法手からだけ選びます。コンパニオンと解説者はどちらの色も操作しません。', 'mode.group': '学習モード', 'mode.companionTitle': 'コンパニオンと学ぶ', 'mode.recommended': 'おすすめ', 'mode.companionDescription': 'すべての石をあなたが打ちます。ランタンが質問し、検証済みの根拠を説明します。', 'mode.humanTitle': '静かな教学対局', 'mode.humanEyebrow': '人間 vs エージェント', 'mode.humanDescription': '調整された対局エージェントと、簡潔なヒントだけで打ちます。', 'mode.theatreTitle': '石の劇場', 'mode.theatreEyebrow': '解説付きエージェント対局', 'mode.theatreDescription': '2 つの棋風が検証済み候補から選ぶ様子を観戦します。', 'mode.cast': '役割と棋風', 'mode.blackMountain': '黒 · 山', 'mode.whiteRiver': '白 · 川', 'mode.opponentRiver': '相手 · 川', 'mode.lanternCompanion': 'ランタン · コンパニオン', 'mode.narratorAuthority': 'ランタンは意図と結果を語るだけで、どちらの手も選びません。',
  'doctrine.balanced': 'バランス', 'doctrine.territory': '実利', 'doctrine.influence': '外勢', 'doctrine.fighting': '戦い', 'doctrine.light': '軽く柔軟', 'style.socratic': '問いかけ中心', 'style.encouraging': '温かい励まし', 'style.concise': '静かで簡潔',
  'play.trainingFocus': '練習の焦点：', 'play.sceneComplete': '完了', 'play.endedPasses': '終局 · 2 回連続パス', 'play.openReflection': '振り返りを開く', 'play.teachingGame': '教学対局', 'play.moves': '{count} 手', 'play.move': '{count} 手目', 'play.gameComplete': '対局完了', 'play.scoreNotSettled': '終局 · 得点未確定', 'play.toPlay': '{name} の手番', 'play.currentPurpose': '現在の目的', 'play.komi': 'コミ {value}', 'play.analyzingAt': '{color} が {coordinate} に打った場合を解析中…', 'play.findingFirst': 'おすすめの第一手を検索中…', 'play.comparing': '次の候補を比較中…', 'play.backSuggestions': '候補に戻る', 'play.rewind': '巻き戻し', 'play.pauseTheatre': '観戦を一時停止', 'play.watch': '続けて観戦', 'play.oneTurn': '解説付きで1手進める', 'play.cancel': 'キャンセル', 'play.previewHint': 'プレビュー中 · 右クリックまたは Esc で解除', 'play.verified': '検証済み', 'play.notLegal': '非合法', 'play.checking': '確認中…', 'play.placeStone': '石を打つ', 'play.chooseAnother': '別の点を選ぶ', 'play.analysisFirst': '先に解析 · 着手はまだロック', 'play.candidatePinned': '候補を固定中 · 右クリックまたは Esc で候補一覧に戻ります。', 'play.selectEmpty': '空いた交点を選び、結果をプレビューします。', 'play.pass': 'パス', 'play.resign': '投了', 'play.timeline': '着手の流れ', 'play.storySoFar': 'ここまでの物語', 'play.firstChronicle': '第一手から棋譜が始まります。', 'play.areaUnsettled': '地と死石が未確定のため、最終得点は宣言しません。', 'rules.positionalSuperko': '位置的超コウ', 'rules.situationalSuperko': '状況的超コウ', 'rules.simpleKo': '単純コウ', 'rules.reasonOccupied': 'その交点には石がある', 'rules.reasonSuicide': '自分の一団をダメなしにする手は打てない', 'rules.reasonSuperko': 'この手は以前の盤面を繰り返す', 'rules.reasonFinished': '対局はすでに終了している', 'rules.reasonOutside': 'その交点は {size} の盤外にある',
  'coach.narrator': '解説者', 'coach.lantern': 'ランタン', 'coach.companion': 'コンパニオン', 'coach.lessonGuide': 'レッスンガイド', 'coach.compass': 'コンパス', 'coach.authority': 'エージェントの権限', 'coach.authorityTheatre': '解説は両方の棋風を説明します。石を打てるのは 2 人の対局エージェントだけです。', 'coach.authorityCompanion': 'ランタンはあなた側ですが、明示的に 1 手だけ委譲しない限り代打ちしません。', 'coach.authorityHuman': 'リバーは教学サービスが検証した合法候補からだけ選びます。', 'coach.intention': 'あなたの意図', 'coach.optional': '任意だが有用', 'coach.moveIntention': '着手の意図', 'intent.unsure': 'わからない', 'intent.claim': '地を取る', 'intent.connect': 'つなぐ', 'intent.pressure': '圧力', 'intent.escape': '逃げる', 'intent.settle': '安定', 'intent.sacrifice': '取引', 'intent.cut': '切る', 'intent.invade': '打ち込み', 'intent.reduce': '消し', 'intent.endgame': '寄せ', 'coach.revealHistory': '会話履歴を表示', 'coach.loadingEarlier': '過去のメッセージを読み込み中…', 'coach.tryEarlier': '過去のメッセージを再読み込み', 'coach.loadEarlier': '過去のメッセージを読み込む', 'coach.recentOnly': '最近のみ表示', 'coach.visibleStillHere': '表示中の会話は残っています。', 'coach.learnerQuestion': '学習者の質問', 'coach.you': 'あなた', 'coach.evidence': '根拠の出典', 'coach.empty': 'ガイドは静かに見守っています。点を選ぶか、質問してください。', 'coach.otherCandidates': '他の候補案', 'coach.candidateIntentions': '候補手の意図', 'coach.notLegalNow': 'この点は現在打てません。', 'coach.hint': '段階的ヒント', 'coach.compare': '比較', 'coach.hintQuestion': '打つ前に何に注目すべきですか？', 'coach.compareQuestion': 'これらの候補手の最も大きな違いを説明してください。', 'coach.ask': 'コーチに聞く', 'coach.askDoctrine': 'どちらの棋風でも質問…', 'coach.askChanged': '何が変わったか質問…', 'coach.invite': 'ランタンにこの 1 手だけ選んでもらう', 'coach.oneTurnOnly': 'この 1 手だけ。', 'coach.keepTurn': '自分で打つ', 'coach.chooseOnce': 'この 1 手だけ選ぶ',
  'candidate.empty': '空いた点を選び、結果を比較します。', 'candidate.list': '候補手の比較', 'candidate.suggested': 'おすすめの第一手', 'candidate.teacherFallback': '教材の代替候補', 'candidate.intentProvenance': '教師の仮説 · 考えられる役割', 'candidate.replyEngine': 'エンジン主変化の応手（強制ではない）', 'candidate.replyExamine': '検討する応手', 'candidate.risk': 'リスク：', 'candidate.noEngine': 'エンジンの裏付けは主張しません。', 'candidate.why': 'なぜここか', 'candidate.changes': '何が変わるか', 'candidate.next': '次に読むこと', 'candidate.teacherInterpretation': '教師の解釈', 'candidate.rulesFacts': 'ルール上の事実', 'candidate.exact': '正確', 'candidate.scoreComparison': '得点予測の比較', 'candidate.supportsComparison': 'これは比較の材料であり、地の事実ではありません。', 'candidate.boardField': '盤上の分布', 'candidate.afterOwnership': '着手後の帰属予測', 'candidate.deltaOwnership': '帰属の変化形状', 'candidate.readNext': '次に読む', 'candidate.interaction': 'ホバーまたはフォーカスで調べます。タップ、クリック、Enter で未着手プレビューを保持し、右クリックまたは Esc で候補一覧に戻ります。',
  'evidence.exact': '正確', 'evidence.tactical': '読み', 'evidence.engine': 'エンジン推定', 'evidence.model': 'モデル説明', 'evidence.teacher': '教師ガイド', 'evidence.metaphor': 'たとえ', 'energy.views': '盤の見方', 'energy.title': '明確な層を個別に切り替える', 'energy.noMagic': '魔法の総合点はない', 'energy.overlays': '教学オーバーレイ', 'energy.ifPlayed': 'ここに打った場合', 'energy.current': '現在の局面', 'lens.cloud': '存在感の図', 'lens.cloudTerm': '距離のたとえ', 'lens.breath': '呼吸', 'lens.liberties': 'ダメ', 'lens.bonds': 'つながり', 'lens.connections': '連絡', 'lens.shelter': '安定', 'lens.eyeSpace': '眼形', 'lens.forecast': '予測', 'lens.ownership': '帰属傾向', 'lens.strong': '強い予測', 'lens.threshold': '表示用の帰属閾値', 'lens.area': '盤面の数', 'lens.areaTerm': '石と空交点', 'lens.turn': '手番', 'lens.side': '次に打つ側', 'lens.pressure': '圧力', 'lens.atari': '仮定手によるアタリ',
  'power.eyebrow': 'この一手を筋道立てて考える', 'power.title': '選択から次の読みまで', 'power.remember': '覚えておく：', 'power.memory': '正確なルール事実、エンジン予測、教師の解釈は別の問いに答えます。予測はまだ自分の地ではありません。', 'power.play': '打つ', 'power.because': '理由', 'power.changes': '変化', 'power.opponent': '相手', 'power.thenCheck': '次に確認', 'power.principle': '原則', 'source.exactRules': '正確なルール', 'source.engine': 'エンジン推定', 'source.lesson': 'レッスンガイド', 'source.teacher': '教師の解釈',
  'chronicle.eyebrow': 'あなたの棋譜', 'chronicle.title': '対局は振り返れる物語になる', 'chronicle.description': '本線、巻き戻し、意図、説明、エンジンの出典を一緒に保存します。', 'chronicle.ended': '終局 · 得点未確定', 'chronicle.revisit': '復習', 'chronicle.unavailableTitle': '現在、履歴を読み込めません。', 'chronicle.unavailableText': '対局はサンプルで置き換えられていません。ローカルサービスへ再接続してください。', 'chronicle.emptyTitle': '最初の対局がここに表示されます。', 'chronicle.emptyText': '終えたレッスンごとに覚えておきたい瞬間が残ります。', 'chronicle.loadingOlder': '過去の対局を読み込み中…', 'chronicle.tryOlder': '過去の対局を再読み込み', 'chronicle.loadOlder': '過去の対局を読み込む', 'chronicle.reviewHall': '振り返り', 'chronicle.inProgress': '対局中', 'chronicle.promise': '構想', 'chronicle.crisis': '危機', 'chronicle.resolution': '収束', 'chronicle.noSummary': 'この対局固有の物語要約はまだ記録されていません。着手履歴は、作り話を加えずに保持されます。', 'chronicle.selectGame': '対局を選ぶ', 'chronicle.selectText': '構想、危機、収束、そして次へ持ち越す原則を見ます。', 'chronicle.recently': '最近',
  'board.black': '黒', 'board.white': '白', 'board.lastMove': '、最終手', 'board.selected': '、プレビュー選択中', 'board.moveLegal': '合法手です。', 'board.checkingConsequences': '結果を確認中。', 'board.openingSketch': '序盤の効率スケッチ', 'board.distanceSketch': '現在の石からの距離スケッチ', 'board.analogy': '初心者向けのたとえ · 手の質ではない', 'board.corner': '隅', 'board.cornerText': '閉じる方向が少ない', 'board.side': '辺', 'board.sideText': '近くの石とつながる', 'board.center': '中央', 'board.centerText': '遠くまで届くが囲うのは遅い', 'board.nearby': '近くの存在感', 'board.violet': '紫', 'board.bothClose': '両方が近い', 'board.sketchDisclaimer': 'この初心者向けスケッチは、現在の石からの距離だけを表します。候補手の順位、物理、地、帰属、得点ではありません。', 'board.smallBoardDisclaimer': 'これは教材用に作成された {size}×{size} 表示です。インストール済み KataGo の根拠は 9×9 のみです。', 'board.separateEstimate': '別の四角い濃淡は KataGo の帰属予測です。', 'board.currentBoard': '現在の盤', 'board.noTerritory': '対局中に確定した地はありません。上の帰属クラウドと得点予測を使い、将来の支配を比較します。',
}

const ar: Catalog = arCatalog
const de: Catalog = deCatalog
const es: Catalog = esCatalog
const fr: Catalog = frCatalog
const ko: Catalog = koCatalog
const ru: Catalog = ruCatalog
const vi: Catalog = viCatalog
const zhHant: Catalog = zhHantCatalog

const catalogs: Record<Locale, Catalog> = {
  en,
  ar,
  es,
  fr,
  ja,
  ko,
  vi,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  de,
  ru,
}

export const MESSAGE_KEYS = Object.freeze(Object.keys(en) as MessageKey[])

export function messagesForLocale(locale: Locale): Readonly<Catalog> {
  return catalogs[locale]
}

export function localeDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

export function documentLocale(locale: Locale) {
  return {
    lang: locale,
    dir: localeDirection(locale),
    title: `Weiqi · ${translate(locale, 'app.name')}`,
    description: translate(locale, 'hero.description'),
  } as const
}

function isTeachingLocale(locale: Locale): locale is TeachingLocale {
  return isAuthoredLocale(locale)
}

// These reviewed phrases replace literal Sino-Japanese wording that is valid
// as data but unnatural in a learner-facing Japanese interface.
const naturalJapanese: Partial<Record<MessageKey, string>> = {
  'notice.authoredPreview': 'ローカル指導サービスの起動中は、作成済みレッスンのプレビューを表示します。',
  'notice.flowInterrupted': '学習の流れが中断されました。',
  'notice.historyPageRepeated': '指導サービスが同じ対局履歴ページを繰り返しました。',
  'notice.conversationPageRepeated': '指導サービスが同じ会話ページを繰り返しました。',
  'hero.illustration': '教材局面のイラスト',
  'doctrine.eyebrow': '私たちの指導方針',
  'doctrine.exactText': 'ルールコードが、ダメ、着手の可否、取り、コウ、得点計算、履歴を管理します。',
  'play.training.guided': 'この場面は作成済みの教材局面から始まります。着手の可否と完了はライブサービスが管理します。',
  'candidate.smallBoardHidden': 'エンジン比較は非表示です。この {size}×{size} レッスンは作成済みの教材表示です。',
  'mode.humanTitle': '静かな練習対局',
  'play.teachingGame': '練習対局',
  'coach.authorityHuman': 'リバーは指導サービスが検証した合法候補からだけ選びます。',
  'energy.overlays': '指導用オーバーレイ',
}

export function normalizeLocale(value: unknown): Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? value as Locale
    : 'en'
}

export function translate(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  const template = locale === 'ja' ? naturalJapanese[key] ?? catalogs.ja[key] : catalogs[locale][key]
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  )
}

export function localizeRulesReason(reason: string | null | undefined, locale: Locale): string | null {
  if (!reason) return null
  const normalized = reason.trim().replace(/[.。]$/, '').toLowerCase()
  const known: Record<string, MessageKey> = {
    'that intersection is occupied': 'rules.reasonOccupied',
    'a move cannot leave its own group without liberties': 'rules.reasonSuicide',
    'the move would repeat an earlier board position': 'rules.reasonSuperko',
    'the game is already finished': 'rules.reasonFinished',
  }
  const key = known[normalized]
  if (key) return translate(locale, key)
  const outside = /^that intersection is outside the (\d+[×x]\d+) board$/i.exec(reason.trim().replace(/[.]$/, ''))
  return outside ? translate(locale, 'rules.reasonOutside', { size: outside[1].replace('x', '×') }) : reason
}

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, values?: Record<string, string | number>) => string
}

const defaultI18n: I18nValue = {
  locale: 'en',
  setLocale: () => undefined,
  t: (key, values) => translate('en', key, values),
}

const I18nContext = createContext<I18nValue>(defaultI18n)

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_KEY))
  } catch {
    return 'en'
  }
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ? normalizeLocale(initialLocale) : readLocale())
  const setLocale = useCallback((next: Locale) => setLocaleState(normalizeLocale(next)), [])
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) =>
    translate(locale, key, values), [locale])

  useEffect(() => {
    const metadata = documentLocale(locale)
    document.documentElement.lang = metadata.lang
    document.documentElement.dir = metadata.dir
    document.title = metadata.title
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute(
      'content',
      metadata.description,
    )
    try {
      window.localStorage.setItem(LOCALE_KEY, locale)
    } catch {
      // The selected locale remains active for this tab.
    }
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <label className={`language-select ${compact ? 'compact' : ''}`}>
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(normalizeLocale(event.target.value))}
        aria-label={t('language.label')}
        data-testid="locale-select"
      >
        {SUPPORTED_LOCALES.map((item) => <option key={item} value={item}>{LOCALE_NAMES[item]}</option>)}
      </select>
    </label>
  )
}

interface LessonTranslation {
  title: string
  subtitle: string
  story: string
  objective: string
  memory: string
  concepts: string[]
}

const lessonTranslations: Record<TeachingLocale, Record<string, LessonTranslation>> = {
  ...lessonTranslationsAdditional,
  'zh-Hans': {
    'breath-5': { title: '最后一口气', subtitle: '先看气，再看战斗', story: '一枚孤子只剩一条路。在包围合拢前，找到它的出路。', objective: '让 C3 的黑子拥有不止一口气。', memory: '一块棋被叫吃时，问：长、连、吃，还是有意舍弃？', concepts: ['气', '叫吃', '逃出'] },
    'bridge-5': { title: '桥', subtitle: '连接能共享气', story: '两枚友军彼此可见，但中间还隔着一个开放交叉点。', objective: '连起 B3 与 D3 的黑子。', memory: '“连接”指沿棋盘线直接相邻，不只是看起来很近。', concepts: ['连接', '断点', '棋形'] },
    'roads-7': { title: '雾中的出路', subtitle: '奔跑、安定，或回头战斗', story: '你的小棋块被压在东侧。选择“活下来”究竟意味着什么。', objective: '给标记的黑棋腾出空间，同时不要再造出一块弱棋。', memory: '奔跑的棋需要开放道路；安定的棋需要安全空间。', concepts: ['弱棋', '逃出', '根据地'] },
    'opening-compass': { title: '选择一个承诺', subtitle: '你真正的第一个 9×9 开局', story: '棋盘是空的。第一枚棋子不占有这里，它只是许下一个承诺。', objective: '选择任何合法开局，并说出它的意图。', memory: '第一手是承诺，还不是已经拥有的地盘。', concepts: ['布局', '外势', '实地', '意图'] },
    'first-expedition': { title: '第一次远征', subtitle: '与安静的陪伴者完成一整局', story: '这一次，道路不会在第一次提子后结束。把对局走到它真正的终点。', objective: '下到双方都停一手，检查机械盘面计数，并在宣布最终目数前识别未定型的棋块。', memory: '连续两次停一手结束对局；宣布最终目差前先确定死子。', concepts: ['完整对局', '停一手', '中国规则面积计分'] },
    'shape-of-power': { title: '力量的形状', subtitle: '外势是潜力，不是已入账的目数', story: '一方有厚壁，另一方有实地。两种力量都不能单独完成一切。', objective: '利用强大的外势，但不要过早声称未定的空间。', memory: '厚势朝向值得影响的地方时才有用。', concepts: ['厚势', '外势', '实地', '方向'] },
    'river-chronicle': { title: '河流棋谱', subtitle: '完整解说的综合课', story: '完成对局，再讲述它的起意、危机、安定与最后的亮光。', objective: '完成并复盘一局 9×9，不要求每手都是引擎最佳。', memory: '最好的复盘会找到一条可重用的原则，而不是列出一串惩罚。', concepts: ['完整对局', '复盘', '反思'] },
    'full-landscape-19': { title: '全局天地', subtitle: '全棋盘上的普通对局', story: '全局天地就此展开。角、边与中央，如今汇成一段彼此相连的旅程。', objective: '依照中国规则面积计分和位置超劫，从布局开始完成一局普通的 19×19 对局，直至双方停一手或一方认输。', memory: '棋盘大小改变的是尺度，不是气、连接或如实计数的含义。', concepts: ['全棋盘', '布局', '大尺度战略'] },
    'first-breath': { title: '第一口气', subtitle: '看见棋子如何存活', story: '一位孤独的斥候进入小山谷。找出让它继续呼吸的每条路。', objective: '看见棋子如何存活。', memory: '数整块棋不重复的气。', concepts: ['气', '叫吃', '提子'] },
    'bridge-builders': { title: '造桥者', subtitle: '道路封闭前先连起来', story: '两位同伴隔河相望，但白棋可能先抵达桥上。', objective: '道路封闭前先连起来。', memory: '连在一起的棋子共享气。', concepts: ['连接', '切断', '棋形'] },
    'two-lanterns': { title: '两盏灯', subtitle: '造出无法同时熄灭的安全居所', story: '一个长室很脆弱。立起支柱，让两盏灯都亮着。', objective: '建立两个独立的眼。', memory: '两个独立的眼能活。', concepts: ['眼', '死活', '要点'] },
    'mist-and-ground': { title: '雾与实地', subtitle: '感受外势，但别把它当成地盘', story: '有些空间已经安定，有些只是可能。学会分清棋子与雾。', objective: '区分外势与实地。', memory: '外势是潜力，不是已入账的分数。', concepts: ['外势', '实地', '先手'] },
    'hunt-run-settle': { title: '追击、奔跑、安定', subtitle: '攻击不必一定要杀死', story: '追逐开始了。决定前进、闪避、逃跑，还是建造安全空间。', objective: '攻击时获得收益，而不只盯着杀棋。', memory: '攻击是为了获利；杀棋只是可能的收益之一。', concepts: ['攻击', '逃出', '弃子'] },
  },
  ja: {
    'breath-5': { title: '最後の呼吸', subtitle: '戦いより先にダメを見る', story: '孤独な斥候に残された道は一つ。包囲が閉じる前に出口を探そう。', objective: 'C3 の黒石に 2 つ以上のダメを与える。', memory: '一団がアタリなら問う：伸びる、つながる、取る、それとも意図的に捨てる？', concepts: ['ダメ', 'アタリ', '脱出'] },
    'bridge-5': { title: '橋', subtitle: '連絡するとダメを共有できる', story: '二つの味方は互いに見えるが、間に開いた渡り場がある。', objective: 'B3 と D3 の黒石をつなぐ。', memory: '「連結」は盤の線に沿って直接接すること。近くにあるだけではない。', concepts: ['連絡', '切断点', '形'] },
    'roads-7': { title: '霧の中の道', subtitle: '走る、安定する、または反撃する', story: '小さな一団が東の稜線に押し付けられている。生きるとは何かを選ぼう。', objective: '印の付いた黒の一団に余地を作り、もう一つの弱い一団は作らない。', memory: '走る一団には開いた道、安定する一団には眼形が必要。', concepts: ['弱い一団', '脱出', '根拠地'] },
    'opening-compass': { title: '約束を選ぶ', subtitle: '初めての本格的な 9×9 序盤', story: '盤は空っぽです。最初の石は土地を所有せず、約束を一つ作ります。', objective: '合法な初手を選び、その意図を言葉にする。', memory: '最初の一手は約束であり、まだ自分の地ではない。', concepts: ['序盤', '外勢', '地', '意図'] },
    'first-expedition': { title: '最初の探検', subtitle: '静かなコンパニオンと一局打ち切る', story: '今回の道は最初の取りで終わらない。局面を本当の終点まで運ぼう。', objective: '両者がパスするまで打ち、機械的な面積スナップショットを確認し、最終得点の前に未確定の石を特定する。', memory: '2 回連続のパスで終局。最終差を宣言する前に死石を確定する。', concepts: ['完全対局', 'パス', '中国ルールの面積計算'] },
    'shape-of-power': { title: '力の形', subtitle: '外勢は可能性であり、確定した得点ではない', story: '一方には厚み、もう一方には地がある。どちらの力も単独では完結しない。', objective: '強い外勢を使いながら、未確定の地を過大評価しない。', memory: '厚みは、影響を与える価値のある方向を向いてこそ役立つ。', concepts: ['厚み', '外勢', '地', '方向'] },
    'river-chronicle': { title: '川の棋譜', subtitle: '解説付きの総仕上げ', story: '対局し、その構想、危機、安定、最後の光を語り直す。', objective: 'エンジンの最善手を必須にせず、9×9 を打ち切って振り返る。', memory: '最良の振り返りは、罰の一覧ではなく、再利用できる原則を一つ見つける。', concepts: ['完全対局', '振り返り', '内省'] },
    'full-landscape-19': { title: '盤上の全景', subtitle: '本盤で打つ通常対局', story: '盤上の全景が開けます。隅、辺、中央が、今や一つにつながった旅路になります。', objective: '中国式面積計算ルールとポジショナル・スーパーコウの下で、序盤からパスまたは投了まで通常の 19×19 対局を打ちます。', memory: '盤の大きさで変わるのは尺度であり、ダメ、連絡、誠実な数え方の意味ではありません。', concepts: ['本盤', '序盤', '大局的な戦略'] },
    'first-breath': { title: '最初の呼吸', subtitle: '石がどう生きるかを見る', story: '孤独な斥候が小さな谷に入る。呼吸を続けられる道をすべて探そう。', objective: '石が生きる仕組みを見る。', memory: '一団全体の異なるダメを数える。', concepts: ['ダメ', 'アタリ', '取り'] },
    'bridge-builders': { title: '橋を架ける', subtitle: '道が閉じる前につなぐ', story: '二つの味方は川越しに見えるが、白が先に橋へ届くかもしれない。', objective: '道が閉じる前につなぐ。', memory: 'つながった石はダメを共有する。', concepts: ['連絡', '切断', '形'] },
    'two-lanterns': { title: '二つの灯り', subtitle: '同時に消されない家を作る', story: '一つの長い部屋は脆い。柱を立て、二つの灯りを残そう。', objective: '独立した二つの眼を作る。', memory: '独立した二眼は生きる。', concepts: ['眼', '死活', '急所'] },
    'mist-and-ground': { title: '霧と地', subtitle: '外勢を感じても地と決めつけない', story: '確定した空間も、まだ可能性だけの空間もある。石と霧を見分けよう。', objective: '外勢と地を区別する。', memory: '外勢は可能性であり、確定得点ではない。', concepts: ['外勢', '地', '先手'] },
    'hunt-run-settle': { title: '追う、走る、安定する', subtitle: '攻めは必ずしも殺すためではない', story: '追跡が始まる。進む、かわす、逃げる、それとも家を作るかを選ぼう。', objective: '殺すことだけを目的にせず、攻めから利益を得る。', memory: '攻めは利益を得るため。殺すことは利益の一つにすぎない。', concepts: ['攻め', '脱出', '捨て石'] },
  },
}

export function localizeLesson(lesson: LessonSummary, locale: Locale): LessonSummary {
  if (!isTeachingLocale(locale)) return lesson
  const translated = lessonTranslations[locale]?.[lesson.id]
  if (!translated) return lesson
  return {
    ...lesson,
    title: translated.title,
    subtitle: translated.subtitle,
    story: translated.story,
    concepts: translated.concepts,
    memory_line: translated.memory,
  }
}

export function localizeCurriculum(curriculum: CurriculumResponse, locale: Locale): CurriculumResponse {
  if (locale === 'en') return curriculum
  return {
    ...curriculum,
    title: translate(locale, 'app.name'),
    lessons: curriculum.lessons.map((lesson) => localizeLesson(lesson, locale)),
  }
}

const deterministicActs: Record<string, Record<TeachingLocale, string>> = {
  'Resolution · Read the finished landscape': { ...deterministicActsAdditional['Resolution · Read the finished landscape'], 'zh-Hans': '收束 · 读懂完成的全局', ja: '収束 · 完了した盤全体を読む' },
  'Arrival · Make the first promise': { ...deterministicActsAdditional['Arrival · Make the first promise'], 'zh-Hans': '抵达 · 许下第一个承诺', ja: '到着 · 最初の約束を作る' },
  'Opening · Give each stone a purpose': { ...deterministicActsAdditional['Opening · Give each stone a purpose'], 'zh-Hans': '布局 · 让每枚棋子都有任务', ja: '序盤 · それぞれの石に役割を与える' },
  'Contact · Build, fight, escape, or connect': { ...deterministicActsAdditional['Contact · Build, fight, escape, or connect'], 'zh-Hans': '接触 · 建造、战斗、逃出或连接', ja: '接触 · 作る、戦う、逃げる、つなぐ' },
  'Contact · Two groups are taking shape': { ...deterministicActsAdditional['Contact · Two groups are taking shape'], 'zh-Hans': '接触 · 两块棋正在成形', ja: '接触 · 二つの一団が形になり始める' },
  'Settlement · Turn potential into readable ground': { ...deterministicActsAdditional['Settlement · Turn potential into readable ground'], 'zh-Hans': '安定 · 把潜力变成可读的地盘', ja: '安定 · 可能性を読める地に変える' },
}

function localizeKnownCoachMessage(game: GameState, message: GameState['coach_messages'][number], locale: Locale) {
  if (!isTeachingLocale(locale)) return message
  const lesson = game.lesson_id ? lessonTranslations[locale][game.lesson_id] : undefined
  if (lesson && message.id === 'authored-opening') {
    return { ...message, speaker: localizeKnownName(message.speaker, locale), text: lesson.story, prompt: lesson.objective }
  }
  if (lesson && message.id === `authored-${game.lesson_id}`) {
    return { ...message, speaker: localizeKnownName(message.speaker, locale), text: lesson.story, prompt: lesson.memory }
  }
  if (!message.id.startsWith('move-')) {
    const evidence = new Set(message.evidence ?? [])
    const generated = evidence.has('teacher') || evidence.has('model')
      ? localizeGeneratedCoachText(message.text, locale, evidence.has('teacher'), lesson?.memory)
      : localizeAuthoredText(locale, message.text)
    return {
      ...message,
      speaker: localizeKnownName(message.speaker, locale),
      text: generated,
      prompt: message.prompt == null ? message.prompt : localizeAuthoredText(locale, message.prompt),
    }
  }
  let moveText = message.text
  let choicePrefix = ''
  const choice = /^(.+?) chose this move through ([a-z0-9._-]+)( by explicit one-move invitation)?\. (.+)$/is.exec(moveText)
  if (choice) {
    const chooser = localizeKnownName(choice[1], locale)
    const source = localizeChoiceSource(choice[2], locale)
    const template = choice[3]
      ? '{chooser} chose this move through {source} by explicit one-move invitation.'
      : '{chooser} chose this move through {source}.'
    choicePrefix = `${localizeAuthoredTemplate(locale, template, { chooser, source })}${
      locale === 'zh-Hans' || locale === 'zh-Hant' || locale === 'ja' ? '' : ' '
    }`
    moveText = choice[4]
  }
  let text = localizeAuthoredText(locale, moveText)
  const captured = /^That move captured (\d+) stone\(s\)\. Count the liberties that vanished\.$/.exec(moveText)
  if (captured) {
    text = localizeAuthoredTemplate(
      locale,
      'That move captured {count} stone(s). Count the liberties that vanished.',
      { count: captured[1] },
    )
  }
  return { ...message, speaker: localizeKnownName(message.speaker, locale), text: `${choicePrefix}${text}`, prompt: lesson?.memory ?? message.prompt }
}

function localizeChoiceSource(source: string, locale: TeachingLocale): string {
  const normalized = source.toLowerCase()
  return normalized === 'openai' || normalized === 'gpt-5.6-sol'
    ? normalized === 'openai' ? 'OpenAI' : 'GPT-5.6 Sol'
    : localizeAuthoredText(locale, normalized)
}

export function localizeKnownName(name: string, locale: Locale): string {
  if (!isTeachingLocale(locale)) return name
  const names: Record<string, Record<TeachingLocale, string>> = {
    You: { ...knownNamesAdditional.You, 'zh-Hans': '你', ja: 'あなた' },
    Mountain: { ...knownNamesAdditional.Mountain, 'zh-Hans': '山', ja: 'マウンテン' },
    River: { ...knownNamesAdditional.River, 'zh-Hans': '河', ja: 'リバー' },
    Lantern: { ...knownNamesAdditional.Lantern, 'zh-Hans': '灯笼', ja: 'ランタン' },
    Narrator: { ...knownNamesAdditional.Narrator, 'zh-Hans': '解说者', ja: '解説者' },
    'Lantern · Narrator': { ...knownNamesAdditional['Lantern · Narrator'], 'zh-Hans': '灯笼 · 解说者', ja: 'ランタン · 解説者' },
    Black: { ...knownNamesAdditional.Black, 'zh-Hans': '黑棋', ja: '黒' },
    White: { ...knownNamesAdditional.White, 'zh-Hans': '白棋', ja: '白' },
  }
  return names[name]?.[locale] ?? name
}

function localizeCandidateSummary(text: string, locale: TeachingLocale): string {
  const known = localizeAuthoredText(locale, text)
  if (known !== text) return known
  const capture = /^Capture (\d+) stone\(s\) and change the liberty balance now\.$/.exec(text)
  return capture
    ? localizeAuthoredTemplate(locale, 'Capture {count} stone(s) and change the liberty balance now.', { count: capture[1] })
    : text
}

function localizeCandidateChanges(text: string, locale: TeachingLocale): string {
  if (text === 'Rules: pass places no stone or captures; the two-consecutive-pass ending rule applies.') {
    return localizeAuthoredText(locale, text)
  }
  const body = /^Rules: (.+)\.$/.exec(text)?.[1]
  if (!body) return text
  const translated: string[] = []
  for (const segment of body.split('; ')) {
    let match: RegExpExecArray | null
    if ((match = /^captures (\d+) stone\(s\)$/.exec(segment))) {
      translated.push(localizeAuthoredTemplate(locale, 'captures {count} stone(s)', { count: match[1] }))
    } else if ((match = /^joins (\d+) friendly groups$/.exec(segment))) {
      translated.push(localizeAuthoredTemplate(locale, 'joins {count} friendly groups', { count: match[1] }))
    } else if ((match = /^takes (\d+) friendly group\(s\) out of atari$/.exec(segment))) {
      translated.push(localizeAuthoredTemplate(locale, 'takes {count} friendly group(s) out of atari', { count: match[1] }))
    } else if ((match = /^puts (\d+) opposing group\(s\) in atari$/.exec(segment))) {
      translated.push(localizeAuthoredTemplate(locale, 'puts {count} opposing group(s) in atari', { count: match[1] }))
    } else if (segment === 'occupies a shared connection point between opposing groups') {
      translated.push(localizeAuthoredText(locale, segment))
    } else if ((match = /^leaves a (\d+)-stone group with (\d+) liberties$/.exec(segment))) {
      translated.push(localizeAuthoredTemplate(locale, 'leaves a {stones}-stone group with {liberties} liberties', { stones: match[1], liberties: match[2] }))
    } else {
      // Translate only when the complete deterministic template is known.
      return text
    }
  }
  const separator = locale === 'ja' ? '、' : locale === 'zh-Hans' || locale === 'zh-Hant' ? '；' : locale === 'ar' ? '؛ ' : '; '
  const colon = locale === 'ja' || locale === 'zh-Hans' || locale === 'zh-Hant' ? '：' : ': '
  return `${localizeAuthoredText(locale, 'Rules')}${colon}${translated.join(separator)}${localizedPeriod(locale)}`
}

function localizeCandidateReply(text: string, locale: TeachingLocale): string {
  const match = /^(Black|White) (pass|[A-HJ-T]\d{1,2})$/i.exec(text)
  if (!match) return text
  const black = match[1].toLowerCase() === 'black'
  const color = translate(locale, black ? 'board.black' : 'board.white')
  const move = match[2].toLowerCase() === 'pass'
    ? translate(locale, 'play.pass')
    : match[2].toUpperCase()
  return `${color} ${move}`
}

function localizeGeneratedCoachText(
  text: string,
  locale: TeachingLocale,
  deterministicFallback: boolean,
  lessonMemory?: string,
): string {
  const modelChoice = text.split('\n\n').some((line) => line.startsWith('Model explanation: '))
  const translatedLines = text.split('\n\n').map((line) => {
    if (line === 'Local-model explanation — not an exact board fact. Verify factual claims against the labeled Energy facets below.') {
      return localizeAuthoredText(locale, line)
    }
    if (line === 'GPT-5.6 Sol was unavailable; opt-in local prose was used and is labeled as model-generated.') {
      return localizeAuthoredText(locale, line)
    }

    if (deterministicFallback) {
      if (line === 'Exact board check — there are no stone groups to compare') {
        return localizeAuthoredText(locale, line)
      }
      const least = /^Exact board check — fewest current liberties: (.+)$/.exec(line)
      if (least) {
        const groups: string[] = []
        for (const item of least[1].split('; ')) {
          const match = /^(Black|White) at ([A-HJ-T]\d{1,2}) has (\d+) libert(?:y|ies)$/.exec(item)
          if (!match) return line
          const color = translate(locale, match[1] === 'Black' ? 'board.black' : 'board.white')
          groups.push(localizeAuthoredTemplate(locale, '{color} at {coordinate} has {count} liberties', {
            color,
            coordinate: match[2],
            count: match[3],
          }))
        }
        const separator = locale === 'ja' ? '、' : locale === 'zh-Hans' || locale === 'zh-Hant' ? '；' : locale === 'ar' ? '؛ ' : '; '
        return localizeAuthoredTemplate(locale, 'Exact board check — fewest current liberties: {groups}', {
          groups: groups.join(separator),
        })
      }
      const candidate = /^(KataGo order candidate|Rules-verified legal candidate): (.+)\.$/.exec(line)
      if (candidate) {
        const source = candidate[1] === 'KataGo order candidate'
          ? localizeAuthoredText(locale, 'KataGo order candidate')
          : localizeAuthoredText(locale, 'Rules-verified legal candidate')
        const coordinate = /^pass$/i.test(candidate[2])
          ? translate(locale, 'play.pass')
          : candidate[2]
        return localizedLabel(locale, source, coordinate, true)
      }
      const hypothesis = /^Teacher hypothesis \(not KataGo's reason\): (.+)$/.exec(line)
      if (hypothesis) {
        return localizedLabel(
          locale,
          localizeAuthoredText(locale, "Teacher hypothesis (not KataGo's reason)"),
          localizeCandidateSummary(hypothesis[1], locale),
        )
      }
      const reply = /^KataGo reply in one main line \(not forced\): (.+)$/.exec(line)
      if (reply) {
        return localizedLabel(
          locale,
          localizeAuthoredText(locale, 'KataGo reply in one main line (not forced)'),
          localizeCandidateReply(reply[1], locale),
        )
      }
      const risk = /^Teacher risk hypothesis: (.+)$/.exec(line)
      if (risk) {
        return localizedLabel(
          locale,
          localizeAuthoredText(locale, 'Teacher risk hypothesis'),
          localizeAuthoredText(locale, risk[1]),
        )
      }
      if (line.startsWith('Remember: ')) {
        const memory = lessonMemory ?? line.slice('Remember: '.length)
        return localizedLabel(locale, localizeAuthoredText(locale, 'Remember'), memory)
      }
      if (line === 'The model companion was unavailable. This fallback separates exact board facts from authored teacher guidance.') {
        return localizeAuthoredText(locale, line)
      }
    }

    const prefixes = [
      'Now',
      'What changed',
      'Why',
      'Candidate coordinate',
      'Model explanation',
      'Teacher hypothesis',
      'Then watch',
      'Remember',
      'Model uncertainty',
    ]
    const prefix = prefixes.find((english) => line.startsWith(`${english}: `))
    if (!prefix) return line
    let body = line.slice(`${prefix}: `.length)
    if (prefix === 'Teacher hypothesis') body = localizeCandidateSummary(body, locale)
    if (prefix === 'Candidate coordinate' && /^pass\.?$/i.test(body)) {
      body = `${translate(locale, 'play.pass')}${body.endsWith('.') ? localizedPeriod(locale) : ''}`
    }
    if (prefix === 'Then watch' && !modelChoice) {
      const reply = localizeCandidateReply(body, locale)
      body = reply === body ? localizeAuthoredText(locale, body) : reply
    }
    return localizedLabel(locale, localizeAuthoredText(locale, prefix), body)
  })
  return translatedLines.join('\n\n')
}

function localizedPeriod(locale: TeachingLocale): string {
  return locale === 'ja' || locale === 'zh-Hans' || locale === 'zh-Hant' ? '。' : '.'
}

function localizedLabel(locale: TeachingLocale, label: string, body: string, period = false): string {
  const colon = locale === 'ja' || locale === 'zh-Hans' || locale === 'zh-Hant' ? '：' : ': '
  return `${label}${colon}${body}${period ? localizedPeriod(locale) : ''}`
}

type LocalizableCandidate = {
  kind?: CandidateMove['kind']
  point: CandidateMove['point']
  coordinate: string
  intent: CandidateMove['intent']
  title: string
  summary?: string
  main_line_reply?: string | null
  risk?: string | null
  facets?: EnergyFacet[]
  why_here?: string | null
  what_changes?: string | null
  next_calculation?: string | null
}

function localizeCandidateFields<T extends LocalizableCandidate>(candidate: T, locale: Locale): T {
  if (!isTeachingLocale(locale)) return candidate
  const localizedCoordinate = candidate.kind === 'pass' || /^pass$/i.test(candidate.coordinate)
    ? translate(locale, 'play.pass')
    : candidate.coordinate
  return {
    ...candidate,
    coordinate: localizedCoordinate,
    // Intent remains a stable protocol ID; every UI presentation resolves it
    // through intent.* catalog keys instead of changing game semantics.
    intent: candidate.intent,
    title: localizeAuthoredText(locale, candidate.title),
    summary: candidate.summary == null ? candidate.summary : localizeCandidateSummary(candidate.summary, locale),
    main_line_reply: candidate.main_line_reply == null ? candidate.main_line_reply : localizeCandidateReply(candidate.main_line_reply, locale),
    risk: candidate.risk == null ? candidate.risk : localizeAuthoredText(locale, candidate.risk),
    facets: candidate.facets?.map((facet) => localizeEnergyFacet(facet, locale)),
    why_here: candidate.why_here == null ? candidate.why_here : localizeCandidateSummary(candidate.why_here, locale),
    what_changes: candidate.what_changes == null ? candidate.what_changes : localizeCandidateChanges(candidate.what_changes, locale),
    next_calculation: candidate.next_calculation == null ? candidate.next_calculation : localizeAuthoredText(locale, candidate.next_calculation),
  } as T
}

export function localizeCandidate(candidate: CandidateMove, locale: Locale): CandidateMove {
  return localizeCandidateFields(candidate, locale)
}

export function localizeMovePreview(preview: MovePreview, locale: Locale): MovePreview {
  if (locale === 'en') return preview
  if (!isTeachingLocale(locale)) return preview
  return {
    ...preview,
    coordinate: /^pass$/i.test(preview.coordinate) ? translate(locale, 'play.pass') : preview.coordinate,
    reason: localizeRulesReason(preview.reason, locale),
    facets: preview.facets.map((facet) => localizeEnergyFacet(facet, locale)),
    candidate_facets: preview.candidate_facets?.map((facet) => localizeEnergyFacet(facet, locale)),
    position_facets: preview.position_facets?.map((facet) => localizeEnergyFacet(facet, locale)),
    if_played_facets: preview.if_played_facets?.map((facet) => localizeEnergyFacet(facet, locale)),
    candidates: preview.candidates.map((candidate) => localizeCandidate(candidate, locale)),
    teaching: preview.teaching
      ? localizeCandidateFields<MoveTeachingEvidence>(preview.teaching, locale)
      : preview.teaching,
    coach_prompt: preview.coach_prompt == null
      ? preview.coach_prompt
      : localizeAuthoredText(locale, preview.coach_prompt),
  }
}

function localizeFacetBody(facet: EnergyFacet, locale: TeachingLocale): Pick<EnergyFacet, 'value' | 'explanation'> {
  let value = facet.value
  let explanation = facet.explanation
  let match: RegExpExecArray | null

  if ((match = /^(\d+) group\(s\) in atari$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, '{count} group(s) in atari', { count: match[1] })
  } else if ((match = /^Black (\d+) · White (\d+)$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, 'Black {black} · White {white}', { black: match[1], white: match[2] })
  } else if (value === 'Not yet settled') {
    value = localizeAuthoredText(locale, value)
  } else if (value === 'Read in review') {
    value = localizeAuthoredText(locale, value)
  } else if ((match = /^(\d+) low-liberty point\(s\)$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, '{count} low-liberty point(s)', { count: match[1] })
  } else if (facet.id === 'reach' && facet.evidence === 'engine' && value === 'Engine ownership field') {
    value = localizeAuthoredText(locale, value)
  } else if (facet.id === 'reach' && facet.evidence === 'metaphor' && value === 'Distance-based presence') {
    value = localizeAuthoredText(locale, value)
  } else if ((match = /^Black (\d+) stones? · White (\d+) stones?$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, 'Black {black} stones · White {white} stones', { black: match[1], white: match[2] })
  } else if ((match = /^(Black|White) to move$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, '{color} to move', {
      color: translate(locale, match[1] === 'Black' ? 'board.black' : 'board.white'),
    })
  } else if (value === 'Ko point present') {
    value = localizeAuthoredText(locale, value)
  } else if (value === 'Unresolved possibilities') {
    value = localizeAuthoredText(locale, value)
  } else if ((match = /^(\d+) liberties$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, '{count} liberties', { count: match[1] })
  } else if (value === 'No stone placed') {
    value = localizeAuthoredText(locale, value)
  } else if ((match = /^Joins (\d+) groups$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, 'Joins {count} groups', { count: match[1] })
  } else if (value === 'No new connection') {
    value = localizeAuthoredText(locale, value)
  } else if ((match = /^(\d+) new atari$/.exec(value))) {
    value = localizeAuthoredTemplate(locale, '{count} new atari', { count: match[1] })
  }

  const knownExplanations = new Set([
    'A group in atari has exactly one distinct liberty.',
    'Orthogonally connected stones form one group and share liberties.',
    'A group needs reliable eye space or enough room to escape; this is not a final life claim.',
    'These are stones or liberties belonging to groups with at most two liberties; this count alone does not decide move priority.',
    'KataGo estimates future ownership; it is not territory already owned.',
    'Presence and tension are deterministic teaching metaphors derived from stone distance and liberties; they are not territory, score, or physical energy.',
    'The turn is exact; whether a reply is forced is a tactical judgment.',
    'Aji names useful possibilities left in a position, not a numeric resource.',
    "The resulting connected string's distinct liberties are counted exactly.",
    "Pass does not create a string or change any group's liberties.",
    'Friendly stones connect only across shared board lines.',
    'Atari means an opposing group has exactly one liberty after the move.',
  ])
  const reachExplanationMatchesEvidence = facet.id !== 'reach' ||
    (facet.evidence === 'engine' && facet.explanation === 'KataGo estimates future ownership; it is not territory already owned.') ||
    (facet.evidence === 'metaphor' && facet.explanation === 'Presence and tension are deterministic teaching metaphors derived from stone distance and liberties; they are not territory, score, or physical energy.')
  if (reachExplanationMatchesEvidence && knownExplanations.has(facet.explanation)) {
    explanation = localizeAuthoredText(locale, facet.explanation)
  } else if ((match = /^(\d+) intersections are empty\. Territory and dead stones are not settled during live play; engine ownership is a separate forecast\.$/.exec(facet.explanation))) {
    explanation = localizeAuthoredTemplate(
      locale,
      '{count} intersections are empty. Territory and dead stones are not settled during live play; engine ownership is a separate forecast.',
      { count: match[1] },
    )
  }
  return { value, explanation }
}

export function localizeEnergyFacet(facet: EnergyFacet, locale: Locale): EnergyFacet {
  if (locale === 'en') return facet
  const terms: Partial<Record<EnergyFacet['id'], [MessageKey, MessageKey]>> = {
    breath: ['lens.breath', 'lens.liberties'], bonds: ['lens.bonds', 'lens.connections'], shelter: ['lens.shelter', 'lens.eyeSpace'], area: ['lens.area', 'lens.areaTerm'], beat: ['lens.turn', 'lens.side'], pressure: ['lens.pressure', 'lens.atari'],
  }
  const pair = facet.id === 'reach'
    ? facet.evidence === 'engine'
      ? ['lens.forecast', 'lens.ownership'] as [MessageKey, MessageKey]
      : facet.evidence === 'metaphor'
        ? ['lens.cloud', 'lens.cloudTerm'] as [MessageKey, MessageKey]
        : undefined
    : terms[facet.id]
  const body = isTeachingLocale(locale)
    ? localizeFacetBody(facet, locale)
    : { value: facet.value, explanation: facet.explanation }
  // Only known deterministic templates are translated above. Unknown engine
  // or model prose remains verbatim so the UI never upgrades a translation to
  // verified evidence.
  return pair
    ? { ...facet, ...body, label: translate(locale, pair[0]), canonical_term: translate(locale, pair[1]) }
    : { ...facet, ...body }
}

export function localizeGame(game: GameState, locale: Locale): GameState {
  if (locale === 'en') return game
  const teachingLocale = isTeachingLocale(locale)
  const lesson = teachingLocale && game.lesson_id ? lessonTranslations[locale][game.lesson_id] : undefined
  return {
    ...game,
    title: lesson?.title ?? game.title,
    lesson_title: lesson?.title ?? game.lesson_title,
    objective: lesson?.objective ?? game.objective,
    concepts: lesson?.concepts ?? game.concepts,
    act: teachingLocale && game.act ? deterministicActs[game.act]?.[locale] ?? game.act : game.act,
    rules: { ...game.rules, name: translate(locale, 'simple.chineseRules') },
    actors: teachingLocale
      ? game.actors.map((actor) => ({ ...actor, name: localizeKnownName(actor.name, locale) }))
      : game.actors,
    coach_messages: game.coach_messages.map((message) => localizeKnownCoachMessage(game, message, locale)),
    analysis: game.analysis ? {
      ...game.analysis,
      facets: game.analysis.facets?.map((facet) => localizeEnergyFacet(facet, locale)),
      candidates: game.analysis.candidates?.map((candidate) => localizeCandidate(candidate, locale)),
    } : game.analysis,
  }
}

export function localizeGameSummary(game: GameSummary, locale: Locale): GameSummary {
  if (!isTeachingLocale(locale) || !game.lesson_id) return game
  const lesson = lessonTranslations[locale][game.lesson_id]
  return lesson ? { ...game, title: lesson.title, lesson_title: lesson.title, concepts: lesson.concepts } : game
}
