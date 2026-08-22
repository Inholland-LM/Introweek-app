import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, RefreshCw, Sparkles, Trophy } from 'lucide-react'
import type { MasterContent } from './import/parseWorkbook'
import { useCompetitionStandings } from './competitionScores'
import { fetchFinaleState, fetchRoundScores, lockFinaleOrder, revealNextFinalist, saveRoundScores, type CompetitionRoundCode, type FinaleState } from './competitionFinale'

const roundLabels: Record<CompetitionRoundCode, string> = { hag: 'HAG', sx: 'SX', city_game: 'City Game · CX, FRH & ENTR', pov_final: 'POV-finale' }

export function CompetitionAdminPanel({ classes }: { classes: MasterContent['classes'] }) {
  const activeClasses = useMemo(() => classes.filter((item) => item.active), [classes])
  const standings = useCompetitionStandings(classes)
  const [round, setRound] = useState<CompetitionRoundCode>('hag')
  const [scores, setScores] = useState<Record<string, string>>({})
  const [published, setPublished] = useState<Record<string, boolean>>({})
  const [finale, setFinale] = useState<FinaleState | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const [rows, nextFinale] = await Promise.all([fetchRoundScores(), fetchFinaleState()])
    const nextScores: Record<string, string> = {}
    const nextPublished: Record<string, boolean> = {}
    rows.forEach((item) => { nextScores[`${item.round_code}:${item.class_code}`] = String(item.points); nextPublished[`${item.round_code}:${item.class_code}`] = item.published })
    setScores(nextScores); setPublished(nextPublished); setFinale(nextFinale)
    if (nextFinale.revealOrder.length) setOrder(nextFinale.revealOrder)
    else setOrder([...standings].sort((a, b) => a.points - b.points || b.classCode.localeCompare(a.classCode, 'nl')).map((item) => item.classCode))
  }

  useEffect(() => { void load().catch(() => setMessage('Het scorebeheer kon niet worden geladen. Voer eerst migratie 022 uit.')) }, [])
  useEffect(() => { if (!finale?.revealOrder.length) setOrder([...standings].sort((a, b) => a.points - b.points || b.classCode.localeCompare(a.classCode, 'nl')).map((item) => item.classCode)) }, [standings, finale?.revealOrder.length])

  const roundScores = activeClasses.map((item) => ({ classCode: item.classCode, points: Number(scores[`${round}:${item.classCode}`]) }))
  const valid = roundScores.length > 0 && roundScores.every((item) => Number.isInteger(item.points) && item.points >= 0 && item.points <= 10000)

  async function save(publish: boolean) {
    if (!valid || busy) return
    if (publish && !window.confirm(`Alle ${roundLabels[round]}-scores nu publiceren?`)) return
    setBusy(true); setMessage('')
    try { await saveRoundScores(round, roundScores, publish); setMessage(publish ? 'Scores gepubliceerd.' : 'Conceptscores opgeslagen.'); await load() }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Opslaan is mislukt.') }
    finally { setBusy(false) }
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= order.length || finale?.phase !== 'preparation') return
    setOrder((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  }

  async function lock() {
    if (busy || !window.confirm('Deze volgorde vastzetten voor de BLEND-finale? Controleer gelijke standen eerst handmatig.')) return
    setBusy(true); setMessage('')
    try { await lockFinaleOrder(order); setMessage('Onthullingsvolgorde staat vast.'); await load() }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Vastzetten is mislukt.') }
    finally { setBusy(false) }
  }

  async function reveal() {
    const classCode = finale?.revealOrder[finale.nextIndex]
    if (!classCode || busy || !window.confirm(`Start de live onthulling voor ${classCode}?`)) return
    setBusy(true); setMessage('')
    try { await revealNextFinalist(classCode); setMessage(`${classCode} is live onthuld. De regie bepaalt wanneer het volgende land start.`); await load() }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Onthullen is mislukt.') }
    finally { setBusy(false) }
  }

  const nextClass = activeClasses.find((item) => item.classCode === finale?.revealOrder[finale.nextIndex])
  return <section className="dashboard-panel competition-admin">
    <div className="panel-header"><div><h2>Landenstrijd &amp; BLEND-regie</h2><p>Publiceer HAG, SX en City Game per klas. Bereid daarna de POV-finale van plek 8 naar 1 voor.</p></div><button type="button" className="secondary-button" onClick={() => void load()}><RefreshCw /> Vernieuwen</button></div>
    {message && <div className="notification-state">{message}</div>}
    <div className="competition-round-tabs">{(Object.keys(roundLabels) as CompetitionRoundCode[]).map((code) => <button type="button" className={round === code ? 'active' : ''} onClick={() => setRound(code)} key={code}>{roundLabels[code]}</button>)}</div>
    <div className="competition-score-editor"><h3>{roundLabels[round]}</h3><div className="competition-score-grid">
      {activeClasses.map((item) => { const key = `${round}:${item.classCode}`; return <label key={item.classCode}><span>{item.flag} <b>{item.country}</b><small>{item.classCode}</small></span><input type="number" min="0" max="10000" value={scores[key] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [key]: event.target.value }))}/>{published[key] && <CheckCircle2 aria-label="Gepubliceerd" />}</label> })}
    </div><div className="header-button-group"><button type="button" className="secondary-button" disabled={!valid || busy} onClick={() => void save(false)}>Concept opslaan</button>{round !== 'pov_final' && <button type="button" className="primary-button" disabled={!valid || busy} onClick={() => void save(true)}>Scores publiceren</button>}</div></div>
    {round === 'pov_final' && <div className="finale-control"><h3><Trophy /> Onthullingsvolgorde</h3><p>De voorgestelde volgorde is gebaseerd op de actuele stand na de City Game. Bij een gelijke stand bepaalt de organisatie de volgorde met de pijlen.</p>
      <ol>{order.map((classCode, index) => { const item=activeClasses.find((entry)=>entry.classCode===classCode); return <li key={classCode}><b>{index + 1}e onthulling</b><span>{item?.flag} {item?.country} <small>{classCode}</small></span><span><button type="button" disabled={index===0 || finale?.phase!=='preparation'} onClick={()=>move(index,-1)} aria-label="Eerder"><ArrowUp /></button><button type="button" disabled={index===order.length-1 || finale?.phase!=='preparation'} onClick={()=>move(index,1)} aria-label="Later"><ArrowDown /></button></span></li>})}</ol>
      {finale?.phase === 'preparation' ? <button className="primary-button" type="button" disabled={busy || order.length!==activeClasses.length} onClick={() => void lock()}><CheckCircle2 /> Volgorde definitief vastzetten</button> : finale?.phase === 'final' ? <div className="notification-state notification-success"><Trophy /> Finale afgerond: dit is de definitieve stand.</div> : <div className="finale-next-card"><span>Volgende onthulling</span><strong>{nextClass?.flag} {nextClass?.country}</strong><small>{nextClass?.classCode} · stap {(finale?.nextIndex ?? 0)+1} van {order.length}</small><button type="button" className="primary-button" disabled={busy} onClick={() => void reveal()}><Sparkles /> Start onthulling voor dit land</button><p>Na de animatie start het volgende land nooit automatisch.</p></div>}
    </div>}
  </section>
}
