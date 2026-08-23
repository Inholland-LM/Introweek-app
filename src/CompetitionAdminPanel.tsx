import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Circle, LockKeyhole, RefreshCw, RotateCcw, Sparkles, Trophy, X } from 'lucide-react'
import type { MasterContent } from './import/parseWorkbook'
import { useCompetitionStandings } from './competitionScores'
import {
  fetchFinaleState,
  fetchCompetitionRehearsalStatus,
  fetchRoundScores,
  lockFinaleOrder,
  revealNextFinalist,
  resetCompetitionTest,
  saveRoundScores,
  setCompetitionRehearsalMode,
  type CompetitionRoundCode,
  type CompetitionRoundScoreInput,
  type FinaleState,
} from './competitionFinale'

const roundLabels: Record<CompetitionRoundCode, string> = {
  hag: 'HAG',
  sx: 'Sports Experiences',
  city_game: 'City Game',
  pov_final: 'POV-finale',
}

const roundHelp: Record<CompetitionRoundCode, string> = {
  hag: 'Voer voor iedere klas één HAG-score in.',
  sx: 'Voer voor iedere klas één totaalscore voor Sports Experiences in.',
  city_game: 'Voer per klas één gezamenlijke totaalscore voor CX, FRH en ENTR in.',
  pov_final: 'Voer de geheime POV-eindscore per klas in en bevestig iedere regel vóór BLEND.',
}

function errorMessage(reason: unknown, fallback: string) {
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') return reason.message
  return fallback
}

export function CompetitionAdminPanel({ classes }: { classes: MasterContent['classes'] }) {
  const activeClasses = useMemo(() => classes.filter((item) => item.active), [classes])
  const standings = useCompetitionStandings(classes)
  const [round, setRound] = useState<CompetitionRoundCode>('hag')
  const [scores, setScores] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [published, setPublished] = useState<Record<string, boolean>>({})
  const [revisions, setRevisions] = useState<Record<string, number>>({})
  const [finale, setFinale] = useState<FinaleState | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [publishChecked, setPublishChecked] = useState(false)
  const [revealChecked, setRevealChecked] = useState(false)
  const [rehearsalEnabled, setRehearsalEnabled] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const [rows, nextFinale, nextRehearsalEnabled] = await Promise.all([
      fetchRoundScores(),
      fetchFinaleState(),
      fetchCompetitionRehearsalStatus(),
    ])
    const nextScores: Record<string, string> = {}
    const nextConfirmed: Record<string, boolean> = {}
    const nextPublished: Record<string, boolean> = {}
    const nextRevisions: Record<string, number> = {}
    rows.forEach((item) => {
      const key = `${item.round_code}:${item.class_code}`
      nextScores[key] = String(item.points)
      nextConfirmed[key] = item.confirmed
      nextPublished[key] = item.published
      nextRevisions[key] = item.revision
    })
    setScores(nextScores)
    setConfirmed(nextConfirmed)
    setPublished(nextPublished)
    setRevisions(nextRevisions)
    setFinale(nextFinale)
    setRehearsalEnabled(nextRehearsalEnabled)
    setPublishChecked(false)
    setRevealChecked(false)
    if (nextFinale.revealOrder.length) setOrder(nextFinale.revealOrder)
    else setOrder([...standings].sort((a, b) => a.points - b.points || b.classCode.localeCompare(a.classCode, 'nl')).map((item) => item.classCode))
  }

  useEffect(() => {
    void load().catch((reason) => setMessage(errorMessage(reason, 'Het scorebeheer kon niet worden geladen. Voer eerst migratie 025 uit.')))
  }, [])
  useEffect(() => {
    if (!finale?.revealOrder.length) {
      setOrder([...standings].sort((a, b) => a.points - b.points || b.classCode.localeCompare(a.classCode, 'nl')).map((item) => item.classCode))
    }
  }, [standings, finale?.revealOrder.length])
  useEffect(() => { setPublishChecked(false) }, [round])
  useEffect(() => { setRevealChecked(false) }, [finale?.nextIndex])

  const enteredScores: CompetitionRoundScoreInput[] = activeClasses.flatMap((item) => {
    const key = `${round}:${item.classCode}`
    if ((scores[key] ?? '').trim() === '') return []
    return [{
      classCode: item.classCode,
      points: Number(scores[key]),
      confirmed: Boolean(confirmed[key]),
      revision: revisions[key] ?? 0,
    }]
  })
  const hasInvalidScore = enteredScores.some((item) => !Number.isInteger(item.points) || item.points < 0 || item.points > 10000)
  const allEntered = enteredScores.length === activeClasses.length && !hasInvalidScore
  const confirmedClasses = activeClasses.filter((item) => confirmed[`${round}:${item.classCode}`])
  const missingClasses = activeClasses.filter((item) => !confirmed[`${round}:${item.classCode}`])
  const allConfirmed = allEntered && confirmedClasses.length === activeClasses.length
  const allPublished = activeClasses.length > 0 && activeClasses.every((item) => published[`${round}:${item.classCode}`])

  async function save(publishNow: boolean) {
    if (!enteredScores.length || hasInvalidScore || busy) return false
    if (publishNow && (!allConfirmed || !publishChecked)) return false
    if (publishNow && !window.confirm(`Alle ${activeClasses.length} bevestigde ${roundLabels[round]}-scores nu in één keer publiceren?`)) return false
    setBusy(true)
    setMessage('')
    try {
      await saveRoundScores(round, enteredScores, publishNow)
      setMessage(publishNow ? `Alle ${roundLabels[round]}-scores zijn gepubliceerd.` : 'Concept en bevestigingen zijn opgeslagen.')
      await load()
      return true
    } catch (reason) {
      setMessage(errorMessage(reason, 'Opslaan is mislukt.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  function setScore(key: string, value: string) {
    if (confirmed[key] || published[key]) return
    setScores((current) => ({ ...current, [key]: value }))
    setPublishChecked(false)
  }

  function setConfirmation(key: string, value: boolean) {
    if (published[key]) return
    setConfirmed((current) => ({ ...current, [key]: value }))
    setPublishChecked(false)
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= order.length || finale?.phase !== 'preparation') return
    setOrder((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function lock() {
    if (busy || !allConfirmed || !window.confirm('Alle acht POV-scores opslaan en deze volgorde definitief vastzetten voor de BLEND-finale?')) return
    setBusy(true)
    setMessage('')
    try {
      await saveRoundScores('pov_final', enteredScores, false)
      await lockFinaleOrder(order)
      setMessage('De acht POV-scores zijn bevestigd en de onthullingsvolgorde staat vast.')
      await load()
    } catch (reason) {
      setMessage(errorMessage(reason, 'Vastzetten is mislukt.'))
    } finally {
      setBusy(false)
    }
  }

  async function reveal() {
    const classCode = finale?.revealOrder[finale.nextIndex]
    if (!classCode || busy || !revealChecked) return
    if (!window.confirm(`De bevestigde POV-score voor ${classCode} nu live onthullen?`)) return
    setBusy(true)
    setMessage('')
    try {
      await revealNextFinalist(classCode, true)
      setMessage(`${classCode} is live onthuld. De regie bepaalt wanneer het volgende land start.`)
      await load()
    } catch (reason) {
      setMessage(errorMessage(reason, 'Onthullen is mislukt.'))
    } finally {
      setBusy(false)
    }
  }

  async function changeRehearsalMode(enabled: boolean) {
    if (busy) return
    const warning = enabled
      ? 'Finalerepetitie starten? Je kunt dan testscores invoeren en één volledige reset uitvoeren. Gebruik dit alleen vóór de echte introweek.'
      : 'Finalerepetitie sluiten zonder de huidige teststanden te wissen?'
    if (!window.confirm(warning)) return

    setBusy(true)
    setMessage('')
    try {
      await setCompetitionRehearsalMode(enabled)
      setRehearsalEnabled(enabled)
      setMessage(enabled
        ? 'Finalerepetitie gestart. Alle ingelogde testrollen worden automatisch op donderdag 16:15 gezet. Doorloop nu de POV-finale.'
        : 'Finalerepetitie gesloten. De volledige reset is weer geblokkeerd.')
    } catch (reason) {
      setMessage(errorMessage(reason, 'De repetitiemodus kon niet worden gewijzigd.'))
    } finally {
      setBusy(false)
    }
  }

  async function resetStrijdTest() {
    if (busy || !rehearsalEnabled || resetConfirmation !== 'RESET STRIJD') return
    if (!window.confirm('Laatste controle: alle teststanden nu definitief wissen en de repetitiemodus automatisch sluiten?')) return

    setBusy(true)
    setMessage('')
    try {
      const result = await resetCompetitionTest(resetConfirmation)
      setRound('pov_final')
      setResetDialogOpen(false)
      setResetConfirmation('')
      setRehearsalEnabled(false)
      setMessage(`Repetitie afgerond en vergrendeld: ${result.removedEvents} puntentoekenning(en), ${result.removedScores} ronde-invoerregel(s) en ${result.clearedPovAwards} POV-fotopuntentoekenning(en) zijn gewist.`)
      await load()
    } catch (reason) {
      setMessage(errorMessage(reason, 'De repetitiestand kon niet worden gewist.'))
    } finally {
      setBusy(false)
    }
  }

  const nextClassCode = finale?.revealOrder[finale.nextIndex]
  const nextClass = activeClasses.find((item) => item.classCode === nextClassCode)
  const nextScore = nextClassCode ? scores[`pov_final:${nextClassCode}`] : undefined

  return <section className="dashboard-panel competition-admin">
    <div className="panel-header">
      <div><h2>Landenstrijd &amp; BLEND-regie</h2><p>Controleer iedere klas afzonderlijk. HAG, Sports Experiences en City Game worden pas gepubliceerd wanneer alle acht klassen bevestigd zijn.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw /> Vernieuwen</button>
    </div>
    {message && <div className="notification-state">{message}</div>}
    <div className="competition-round-tabs">
      {(Object.keys(roundLabels) as CompetitionRoundCode[]).map((code) => <button type="button" className={round === code ? 'active' : ''} onClick={() => setRound(code)} key={code}>{roundLabels[code]}</button>)}
    </div>
    <div className="competition-score-editor">
      <div className="competition-editor-heading"><div><h3>{roundLabels[round]}</h3><p>{roundHelp[round]}</p></div><strong>{confirmedClasses.length} van {activeClasses.length} bevestigd</strong></div>
      <div className="competition-score-grid">
        {activeClasses.map((item) => {
          const key = `${round}:${item.classCode}`
          const scoreValid = Number.isInteger(Number(scores[key])) && Number(scores[key]) >= 0 && Number(scores[key]) <= 10000 && (scores[key] ?? '').trim() !== ''
          const isConfirmed = Boolean(confirmed[key])
          const isPublished = Boolean(published[key])
          return <div className={`competition-score-row${isConfirmed ? ' is-confirmed' : ''}${isPublished ? ' is-published' : ''}`} key={item.classCode}>
            <span className="competition-class-name">{item.flag} <b>{item.country}</b><small>{item.classCode}</small></span>
            <label className="competition-points-field"><span>Punten</span><input aria-label={`Punten voor ${item.classCode}`} type="number" min="0" max="10000" disabled={isConfirmed || isPublished || busy} value={scores[key] ?? ''} onChange={(event) => setScore(key, event.target.value)} /></label>
            <label className="competition-confirm-field">
              <input type="checkbox" checked={isConfirmed} disabled={!scoreValid || isPublished || busy} onChange={(event) => setConfirmation(key, event.target.checked)} />
              {isConfirmed ? <CheckCircle2 /> : <Circle />}
              <span>{isPublished ? 'Gepubliceerd' : isConfirmed ? 'Klas en punten bevestigd' : 'Klas en punten controleren'}</span>
            </label>
          </div>
        })}
      </div>
      <div className="competition-confirm-progress">
        <div><strong>{confirmedClasses.length} van {activeClasses.length} klassen bevestigd</strong>{missingClasses.length > 0 && <span>Nog te controleren: {missingClasses.map((item) => item.classCode).join(', ')}</span>}</div>
        <button type="button" className="secondary-button" disabled={!enteredScores.length || hasInvalidScore || busy || allPublished} onClick={() => void save(false)}>Concept en bevestigingen opslaan</button>
      </div>
      {round !== 'pov_final' && allConfirmed && !allPublished && <div className="competition-publish-review">
        <h4>Laatste controle vóór publicatie</h4>
        <ul>{activeClasses.map((item) => <li key={item.classCode}><span>{item.flag} {item.classCode}</span><strong>{scores[`${round}:${item.classCode}`]} punten</strong></li>)}</ul>
        <label><input type="checkbox" checked={publishChecked} disabled={busy} onChange={(event) => setPublishChecked(event.target.checked)} /> Ik heb alle klassen en punten hierboven gecontroleerd.</label>
        <button type="button" className="primary-button" disabled={!publishChecked || busy} onClick={() => void save(true)}><CheckCircle2 /> Alle {activeClasses.length} scores tegelijk publiceren</button>
      </div>}
      {round !== 'pov_final' && allPublished && <div className="notification-state notification-success"><LockKeyhole /> Deze ronde is voor alle klassen gepubliceerd en vergrendeld.</div>}
    </div>
    {round === 'pov_final' && <div className="finale-control">
      <h3><Trophy /> Onthullingsvolgorde</h3>
      <p>De voorgestelde volgorde is gebaseerd op de stand na de City Game: van de huidige laatste plaats naar de eerste. Bij een gelijke stand bepaalt de organisatie de volgorde met de pijlen.</p>
      <ol>{order.map((classCode, index) => {
        const item = activeClasses.find((entry) => entry.classCode === classCode)
        return <li key={classCode}><b>{index + 1}e onthulling</b><span>{item?.flag} {item?.country} <small>{classCode}</small></span><span><button type="button" disabled={index === 0 || finale?.phase !== 'preparation'} onClick={() => move(index, -1)} aria-label="Eerder"><ArrowUp /></button><button type="button" disabled={index === order.length - 1 || finale?.phase !== 'preparation'} onClick={() => move(index, 1)} aria-label="Later"><ArrowDown /></button></span></li>
      })}</ol>
      {finale?.phase === 'preparation' ? <button className="primary-button" type="button" disabled={busy || order.length !== activeClasses.length || !allConfirmed} onClick={() => void lock()}><CheckCircle2 /> Acht scores en volgorde definitief vastzetten</button>
        : finale?.phase === 'final' ? <div className="notification-state notification-success"><Trophy /> Finale afgerond: dit is de definitieve stand.</div>
          : <div className="finale-next-card"><span>Volgende onthulling</span><strong>{nextClass?.flag} {nextClass?.country}</strong><small>{nextClass?.classCode} · stap {(finale?.nextIndex ?? 0) + 1} van {order.length}</small><div className="finale-score-check"><b>{nextScore} punten</b><label><input type="checkbox" checked={revealChecked} disabled={busy} onChange={(event) => setRevealChecked(event.target.checked)} /> Ik bevestig dat dit het juiste land en puntenaantal is.</label></div><button type="button" className="primary-button" disabled={busy || !revealChecked} onClick={() => void reveal()}><Sparkles /> Onthul score voor dit land</button><p>Na de animatie start het volgende land nooit automatisch.</p></div>}
      {rehearsalEnabled ? <aside className="finale-reset-control is-rehearsing">
        <AlertTriangle aria-hidden="true" />
        <div><strong>Finalerepetitie actief</strong><p>Test de volledige finale. Wis daarna alle testscores; de repetitiemodus sluit dan automatisch.</p></div>
        <div className="finale-rehearsal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void changeRehearsalMode(false)}><LockKeyhole /> Sluiten zonder wissen</button>
          <button type="button" className="danger-button" disabled={busy} onClick={() => { setResetConfirmation(''); setResetDialogOpen(true) }}><RotateCcw /> Repetitie wissen</button>
        </div>
      </aside> : <aside className="finale-reset-control is-locked">
        <LockKeyhole aria-hidden="true" />
        <div><strong>Live-modus actief</strong><p>De volledige reset is vergrendeld. Start alleen vóór de introweek tijdelijk een finalerepetitie.</p></div>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void changeRehearsalMode(true)}><Sparkles /> Start finalerepetitie</button>
      </aside>}
      {resetDialogOpen && rehearsalEnabled && <div className="modal-overlay finale-reset-overlay" role="presentation" onClick={() => { if (!busy) setResetDialogOpen(false) }}>
        <article className="modal-dialog-card finale-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="finale-reset-title" aria-describedby="finale-reset-description" onClick={(event) => event.stopPropagation()}>
          <header className="modal-dialog-header">
            <div className="finale-reset-title"><AlertTriangle /><h2 id="finale-reset-title">Finalerepetitie wissen?</h2></div>
            <button type="button" className="close-modal-icon-btn" aria-label="Annuleren" disabled={busy} onClick={() => setResetDialogOpen(false)}><X /></button>
          </header>
          <div className="modal-dialog-body finale-reset-dialog-body">
            <p id="finale-reset-description">Alle testpunten van HAG, Sports Experiences, City Game, de POV-finale en losse POV-foto’s worden definitief gewist.</p>
            <div className="finale-reset-preserved"><strong>Blijft behouden</strong><span>Ingezonden foto’s, klassen, gebruikers en alle overige app-inhoud.</span></div>
            <label htmlFor="finale-reset-confirmation">Typ exact <b>RESET STRIJD</b>. Na het wissen wordt de reset automatisch weer vergrendeld.</label>
            <input id="finale-reset-confirmation" type="text" autoComplete="off" autoFocus disabled={busy} value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} />
          </div>
          <footer className="modal-dialog-footer finale-reset-dialog-footer">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setResetDialogOpen(false)}>Annuleren</button>
            <button type="button" className="danger-button" disabled={busy || resetConfirmation !== 'RESET STRIJD'} onClick={() => void resetStrijdTest()}><RotateCcw /> Wissen en repetitie sluiten</button>
          </footer>
        </article>
      </div>}
    </div>}
  </section>
}
