import { describe, expect, it } from 'vitest'
import deCatalog from './locales/de.json'
import esCatalog from './locales/es.json'
import frCatalog from './locales/fr.json'

type Catalog = Record<string, string>

function expectEntries(catalog: Catalog, expected: Catalog): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(catalog[key], key).toBe(value)
  }
}

describe('reviewed western-language teaching semantics', () => {
  it('keeps Spanish turns, stone placement, board maps, and board ARIA precise', () => {
    expectEntries(esCatalog, {
      'hero.lanternAsks': 'Linterna pregunta',
      'campaign.title': 'Empieza poco a poco. Alcanza todo el valle.',
      'play.toPlay': 'Turno de {name}',
      'play.analysisFirst': 'Análisis primero · la colocación de la piedra sigue bloqueada',
      'rules.reasonFinished': 'el juego ya está terminado',
      'coach.intention': 'tu intención',
      'candidate.boardField': 'Vista del tablero',
      'board.grid': 'Tablero de Weiqi de {size}×{size}. Turno: {color}.',
      'board.stone': '{coordinate}, piedra: {color}{last}',
      'board.empty': '{coordinate}, intersección vacía{selected}',
      'board.selected': ', seleccionada para vista previa',
      'board.toPlay': 'Turno: {color}.',
      'board.presenceExplanation': 'Explicación del boceto de presencia para principiantes.',
      'board.cornerText': 'menos direcciones que cerrar',
      'board.sideText': 'conecta piedras cercanas',
      'board.bothClose': 'ambos están cerca',
      'board.emptyTurn': '{count} intersecciones vacías · turno: {color}',
      'board.noPassMap': 'No se proporcionó un mapa de control después del pase. Pasar no coloca ninguna piedra; no se inventa una forma de calidad de jugada.',
      'board.noMoveMap': 'No se proporcionó un mapa de control después de la jugada. La piedra fantasma solo muestra la ubicación; no se inventa una forma de calidad de jugada.',
    })
  })

  it('keeps Spanish learner actions informal and provenance explicit', () => {
    expectEntries(esCatalog, {
      'nav.openSimple': 'Abre la vista simple de pantalla completa',
      'notice.commitOffline': 'Vuelve a conectar el servicio de reglas deterministas para confirmar una jugada. El tablero actual es una vista previa segura.',
      'notice.previewMismatch': 'La vista previa ya no coincide con la posición de este tablero. Vuelve a seleccionar el punto.',
      'simple.beginSmall': 'Empieza en un tablero pequeño y aprende una relación a la vez.',
      'simple.safety': 'Tú inspeccionas primero. Una piedra se coloca solo después de la vista previa de las reglas y tu confirmación.',
      'hero.seeTeaching': 'Descubre cómo funciona la enseñanza',
      'mode.theatreDescription': 'Observa cómo dos filosofías de juego eligen entre jugadas candidatas verificadas mientras un narrador enseña.',
      'play.openReflection': 'Abrir la reflexión',
      'play.gameComplete': 'Partida terminada',
      'play.previewHint': 'Vista previa · haz clic derecho en el tablero o pulsa Esc para deseleccionar',
      'play.candidatePinned': 'Jugada candidata fijada · haz clic derecho en el tablero o pulsa Esc para volver a las sugerencias del agente.',
      'play.selectEmpty': 'Selecciona una intersección vacía para obtener una vista previa de sus consecuencias.',
      'coach.tryEarlier': 'Intenta cargar mensajes anteriores de nuevo',
      'coach.empty': 'El guía observa en silencio. Selecciona un punto o haz una pregunta.',
      'coach.compareQuestion': 'Explica el contraste más fuerte entre estos candidatos.',
      'coach.askDoctrine': 'Pregunta sobre cualquiera de las doctrinas...',
      'coach.delegationExplanation': 'Bajo tu autorización explícita, Linterna elegirá entre los candidatos verificados por el servidor y vinculados a la posición actual del tablero. Linterna sigue siendo un compañero que no juega y cada turno posterior sigue siendo tuyo.',
      'candidate.empty': 'Selecciona un punto vacío para comparar sus consecuencias.',
      'candidate.inspectAria': '{prefix}{coordinate}, {title}. Examina esta jugada candidata; haz clic o pulsa Entrar para seleccionar una vista previa que no ejecuta la jugada.',
      'candidate.interaction': 'Pasa el cursor o enfoca para examinar. Toca, haz clic o pulsa Entrar para conservar una vista previa que no ejecuta la jugada. Haz clic derecho en el tablero o pulsa Esc para volver a las sugerencias del agente.',
      'energy.title': 'Mostrar u ocultar una capa claramente identificada',
      'chronicle.unavailableText': 'Tus partidas no fueron reemplazadas con datos de muestra. Vuelve a conectar el servicio local e inténtalo de nuevo.',
      'chronicle.selectText': 'Descubre su promesa, crisis, resolución y un principio que vale la pena llevar adelante.',
      'board.noTerritory': 'Durante la partida en curso no hay territorio definitivamente resuelto. Usa la nube de control estimado y el pronóstico de puntuación etiquetados arriba para comparar el posible control futuro.',
      'board.teacherWeather': 'Lee la capa de color como un pronóstico del tiempo, no como un campo de fuerza. Las libertades, conexiones, amenazas y respuestas son las causas.',
    })
  })

  it('keeps French formal, Go-specific, and accessible wording exact', () => {
    expectEntries(frCatalog, {
      'simple.safety': 'Vous inspectez d’abord. Une pierre n’est posée qu’après l’aperçu des règles et votre confirmation.',
      'hero.title': 'Ne mémorisez pas le goban.',
      'hero.youPlace': 'Vous posez vos pierres',
      'hero.youLantern': 'Vous + Lanterne',
      'mode.humanDescription': 'Vous affrontez un Agent Joueur calibré qui ne reçoit que des consignes de leçon concises.',
      'play.openReflection': 'Ouvrir la réflexion',
      'play.toPlay': 'Au tour de {name}',
      'rules.reasonOutside': 'cette intersection est à l’extérieur du goban {size}',
      'operation.previewing': 'Lecture du point…',
      'operation.moving': 'Vérification et pose…',
      'operation.coach': 'Le compagnon prépare une explication fondée…',
      'coach.you': 'Vous',
      'coach.delegationExplanation': 'Sous votre autorité explicite, Lanterne choisira parmi les candidats vérifiés par le serveur et liés à la position actuelle du goban. Lanterne reste un compagnon non-joueur et chaque tour ultérieur reste le vôtre.',
      'candidate.risk': 'Risque :',
      'candidate.boardField': 'Vue du goban',
      'candidate.smallBoardHidden': 'La comparaison fournie par le moteur est masquée : cette leçon {size}×{size} est une vue pédagogique créée.',
      'energy.title': 'Afficher ou masquer un calque clairement identifié',
      'lens.strong': 'Prévision forte',
      'power.remember': 'À retenir :',
      'source.exactRules': 'Règles exactes',
      'board.grid': 'Goban de Weiqi {size}×{size}. Au tour de {color}.',
      'board.stone': '{coordinate}, pierre — {color}{last}',
      'board.empty': '{coordinate}, intersection vide{selected}',
      'board.selected': ', sélectionnée pour l’aperçu',
      'board.toPlay': 'Au tour de {color}.',
      'board.noPassMap': 'Aucune carte de contrôle après la passe n’a été fournie. Passer ne pose aucune pierre ; aucune forme de qualité du coup n’est inventée.',
      'board.noMoveMap': 'Aucune carte de contrôle après le coup n’a été fournie. La pierre fantôme indique seulement l’emplacement ; aucune forme de qualité du coup n’est inventée.',
    })
  })

  it('keeps German formal, map-based, and accessible wording exact', () => {
    expectEntries(deCatalog, {
      'notice.delegationUnavailable': 'In dieser Stellung ist entweder der Mensch nicht am Zug oder kein Begleiter für die Delegation genau eines Zuges verfügbar.',
      'simple.openBoard': 'Brett öffnen',
      'hero.title': 'Lernen Sie das Brett nicht auswendig.',
      'hero.youPlace': 'Sie setzen Ihre Steine',
      'hero.youLantern': 'Sie + Laterne',
      'doctrine.companionText': 'Laterne fragt, erklärt und denkt nach. Sie bleiben am Zug.',
      'mode.companionDescription': 'Sie spielen jeden Stein. Laterne stellt Fragen und erläutert verifizierte Belege.',
      'play.openReflection': 'Reflexion öffnen',
      'play.toPlay': 'Am Zug: {name}',
      'operation.coach': 'Der Begleiter bereitet eine fundierte Erklärung vor…',
      'coach.you': 'Sie',
      'coach.delegationExplanation': 'Unter Ihrer ausdrücklichen Genehmigung wählt Laterne aus den positionsgebundenen, verifizierten Kandidaten des Servers aus. Laterne bleibt ein nicht spielender Begleiter und jeder weitere Spielzug gehört Ihnen.',
      'candidate.boardField': 'Brettansicht',
      'energy.title': 'Eine klar abgegrenzte Ebene ein- oder ausschalten',
      'power.remember': 'Merke:',
      'board.stone': '{coordinate}, Stein: {color}{last}',
      'board.stoneCount': 'Steine · Schwarz {black} · Weiß {white}',
      'board.noPassMap': 'Für die Stellung nach dem Aussetzen wurde keine Besitzprognosekarte geliefert. Beim Aussetzen wird kein Stein gesetzt; eine Form der Zugqualität wird nicht erfunden.',
      'board.noMoveMap': 'Für die Stellung nach dem Zug wurde keine Besitzprognosekarte geliefert. Der Geisterstein zeigt nur den Ort; eine Form der Zugqualität wird nicht erfunden.',
    })
  })

  it('contains neither invisible zero-width spaces nor untranslated role names', () => {
    for (const catalog of [esCatalog, frCatalog, deCatalog]) {
      const visibleCopy = Object.values(catalog).join('\n')
      expect(visibleCopy).not.toContain('\u200B')
      expect(visibleCopy).not.toMatch(/\b(?:lantern|river|companion)\b/i)
    }
  })
})
