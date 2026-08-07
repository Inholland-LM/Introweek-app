import { useState, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Search, ShieldCheck, Upload, UsersRound } from 'lucide-react'
import { applyMasterImport, compareMasterImport, type AppliedImport, type ContentComparison, type ImportChange, type ImportComparison, type ImportChangeStatus } from './compareImport'
import { parseImportWorkbook, type ImportPerson, type ImportPreview } from './parseWorkbook'

const statusLabels: Record<ImportChangeStatus, string> = {
  new: 'Nieuw',
  changed: 'Gewijzigd',
  conflict: 'Conflict',
  deactivated: 'Deactiveren',
}

type ChangeFilter = 'all' | ImportChangeStatus

const changePageSize = 10
const changeStatusPriority: Record<ImportChangeStatus, number> = {
  conflict: 0,
  new: 1,
  changed: 2,
  deactivated: 3,
}

const fieldDefinitions = {
  voornaam: { key: 'firstName', label: 'Voornaam' },
  tussenvoegsel: { key: 'namePrefix', label: 'Tussenvoegsel' },
  achternaam: { key: 'lastName', label: 'Achternaam' },
  'e-mailadres': { key: 'email', label: 'E-mailadres' },
  rol: { key: 'role', label: 'Rol' },
  klas: { key: 'classCode', label: 'Klas' },
  actief: { key: 'active', label: 'Status' },
} as const

const roleLabels: Record<ImportPerson['role'], string> = {
  student: 'Student',
  buddy: 'Buddy',
  poer: 'PO’er',
  interested_teacher: 'Docent / Medewerker',
  organizer: 'Organisatie',
}

function displayFieldValue(field: keyof typeof fieldDefinitions, value: unknown) {
  if (field === 'rol' && typeof value === 'string' && value in roleLabels) {
    return roleLabels[value as ImportPerson['role']]
  }
  if (field === 'actief' && typeof value === 'boolean') return value ? 'Actief' : 'Inactief'
  if (value === null || value === undefined || value === '') return 'Niet ingevuld'
  return String(value)
}

function ChangeDetails({ change, incoming }: { change: ImportChange; incoming?: ImportPerson }) {
  if (change.status === 'deactivated') {
    return (
      <dl className="comparison-differences">
        <div><dt>Status</dt><dd><span>Actief</span><ArrowRight aria-hidden="true" /><strong>Gedeactiveerd</strong></dd></div>
      </dl>
    )
  }

  if (change.status === 'new') {
    return <p className="comparison-new-summary">Nieuwe {incoming ? roleLabels[incoming.role].toLowerCase() : 'deelnemer'}{incoming?.classCode ? ` in ${incoming.classCode}` : ''}</p>
  }

  if (!change.previousValues || !incoming) {
    return change.fields.length > 0 ? <p>Gewijzigde velden: {change.fields.join(', ')}</p> : null
  }

  return (
    <dl className="comparison-differences">
      {change.fields.map((field) => {
        const definition = fieldDefinitions[field as keyof typeof fieldDefinitions]
        if (!definition) return null
        const key = definition.key
        return (
          <div key={field}>
            <dt>{definition.label}</dt>
            <dd>
              <span>{displayFieldValue(field as keyof typeof fieldDefinitions, change.previousValues?.[key])}</span>
              <ArrowRight aria-hidden="true" />
              <strong>{displayFieldValue(field as keyof typeof fieldDefinitions, incoming[key])}</strong>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export function ImportPreviewPanel({ onApplied }: { onApplied?: () => void } = {}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<ImportComparison | null>(null)
  const [contentComparison, setContentComparison] = useState<ContentComparison | null>(null)
  const [appliedImport, setAppliedImport] = useState<AppliedImport | null>(null)
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all')
  const [changeSearch, setChangeSearch] = useState('')
  const [changePage, setChangePage] = useState(0)

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setLoading(true)
    setError('')
    setPreview(null)
    setComparison(null)
    setContentComparison(null)
    setConfirming(false)
    setAppliedImport(null)
    setChangeFilter('all')
    setChangeSearch('')
    setChangePage(0)
    try {
      setPreview(await parseImportWorkbook(file))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Het Excelbestand kon niet worden gelezen.')
    } finally {
      setLoading(false)
    }
  }

  const roleCounts = preview?.rows.reduce<Record<string, number>>((counts, person) => {
    counts[person.role] = (counts[person.role] ?? 0) + 1
    return counts
  }, {}) ?? {}
  const classCount = new Set(preview?.rows.map((person) => person.classCode).filter(Boolean)).size
  const ready = Boolean(preview && preview.rows.length > 0 && preview.issues.length === 0)
  const changes = comparison ? [...comparison.changes, ...comparison.deactivations] : []
  const orderedChanges = [...changes].sort((left, right) => (
    changeStatusPriority[left.status] - changeStatusPriority[right.status]
    || left.displayName.localeCompare(right.displayName, 'nl')
  ))
  const normalizedChangeSearch = changeSearch.trim().toLocaleLowerCase('nl')
  const filteredChanges = orderedChanges.filter((change) => {
    if (changeFilter !== 'all' && change.status !== changeFilter) return false
    if (!normalizedChangeSearch) return true
    return [change.displayName, change.identifier, change.classCode, ...change.fields]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('nl').includes(normalizedChangeSearch))
  })
  const changePageCount = Math.max(1, Math.ceil(filteredChanges.length / changePageSize))
  const safeChangePage = Math.min(changePage, changePageCount - 1)
  const visibleChanges = filteredChanges.slice(safeChangePage * changePageSize, (safeChangePage + 1) * changePageSize)
  const visibleChangeStart = filteredChanges.length ? safeChangePage * changePageSize + 1 : 0
  const visibleChangeEnd = Math.min((safeChangePage + 1) * changePageSize, filteredChanges.length)

  function selectChangeFilter(filter: ChangeFilter) {
    setChangeFilter(filter)
    setChangePage(0)
  }

  async function compareWithCurrentData() {
    if (!preview || !ready) return
    setComparing(true)
    setError('')
    setComparison(null)
    setConfirming(false)
    setAppliedImport(null)
    try {
      const result = await compareMasterImport(preview.rows, preview.content)
      setComparison(result.people)
      setContentComparison(result.content)
      setChangeFilter(result.people.conflicts > 0 ? 'conflict' : 'all')
      setChangeSearch('')
      setChangePage(0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vergelijken lukt nu niet.')
    } finally {
      setComparing(false)
    }
  }

  async function applyConfirmedImport() {
    if (!preview || !comparison || !contentComparison || comparison.conflicts > 0 || contentComparison.missing > 0) return
    setApplying(true)
    setError('')
    try {
      const result = await applyMasterImport(preview.rows, comparison.stateVersion, preview.content, contentComparison.version)
      setComparison(result.people)
      setAppliedImport(result.people)
      setConfirming(false)
      onApplied?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verwerken lukt nu niet.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <div className="more-panel-heading">
        <div><p className="eyebrow">Beveiligd beheer</p><h2>Deelnemers importeren</h2></div>
        <FileSpreadsheet aria-hidden="true" />
      </div>

      <div className="import-privacy">
        <ShieldCheck aria-hidden="true" />
        <p><strong>Eerst veilig controleren</strong>Het bestand wordt alleen op dit apparaat gelezen. Er wordt in deze stap niets naar Supabase gestuurd of gewijzigd.</p>
      </div>

      <label className={`import-file-button${loading ? ' loading' : ''}`}>
        <Upload aria-hidden="true" />
        <span>{loading ? 'Bestand controleren…' : 'Kies het ingevulde Excelbestand'}</span>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={loading} />
      </label>

      {error && <p className="import-error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>}

      {preview && (
        <section className="import-result" aria-live="polite">
          <div className="import-file-name"><FileSpreadsheet aria-hidden="true" /><span><small>Gecontroleerd bestand</small><strong>{preview.fileName}</strong></span></div>
          <div className="import-summary">
            <article><UsersRound aria-hidden="true" /><strong>{preview.rows.length}</strong><span>geldige personen</span></article>
            <article><strong>{classCount}</strong><span>klassen</span></article>
            <article className={preview.issues.length ? 'has-errors' : ''}><strong>{preview.issues.length}</strong><span>problemen</span></article>
          </div>
          <div className="import-content-summary">
            <strong>Organisatie-inhoud</strong>
            <span>{preview.content.programmes.length} programmaonderdelen</span>
            <span>{preview.content.locations.length} locaties</span>
            <span>{preview.content.messages.length} berichten</span>
            <span>{preview.content.povAssignments.length} POV-opdrachten</span>
            <span>{preview.content.practical.length} praktische items</span>
          </div>

          {ready ? (
            <>
              <div className="import-ready"><CheckCircle2 aria-hidden="true" /><p><strong>Klaar voor vergelijking</strong>Studenten {roleCounts.student ?? 0} · buddy’s {roleCounts.buddy ?? 0} · PO’ers {roleCounts.poer ?? 0} · organisatoren {roleCounts.organizer ?? 0}</p></div>
              <button className="import-compare-button" onClick={compareWithCurrentData} disabled={comparing || applying}>
                <span>{comparing ? 'Veilig vergelijken…' : comparison ? 'Vergelijk opnieuw' : 'Vergelijk met huidige gegevens'}</span><ArrowRight aria-hidden="true" />
              </button>
            </>
          ) : (
            <div className="import-issues">
              <h3><AlertTriangle aria-hidden="true" />Los dit eerst op</h3>
              <ul>{preview.issues.slice(0, 12).map((issue, index) => <li key={`${issue.row}-${issue.message}-${index}`}><b>Rij {issue.row}</b><span>{issue.message}</span></li>)}</ul>
              {preview.issues.length > 12 && <p>En nog {preview.issues.length - 12} problemen.</p>}
            </div>
          )}

          {comparison && (
            <section className="comparison-result" aria-labelledby="comparison-title">
              <div className="comparison-heading"><div><p className="eyebrow">Nog niets gewijzigd</p><h3 id="comparison-title">Gevonden mutaties</h3></div><ShieldCheck aria-hidden="true" /></div>
              <div className="comparison-counts">
                <button type="button" className={changeFilter === 'new' ? 'active' : ''} aria-pressed={changeFilter === 'new'} onClick={() => selectChangeFilter('new')}><b>{comparison.new}</b> nieuw</button>
                <button type="button" className={changeFilter === 'changed' ? 'active' : ''} aria-pressed={changeFilter === 'changed'} onClick={() => selectChangeFilter('changed')}><b>{comparison.changed}</b> gewijzigd</button>
                <button type="button" className={changeFilter === 'deactivated' ? 'active' : ''} aria-pressed={changeFilter === 'deactivated'} onClick={() => selectChangeFilter('deactivated')}><b>{comparison.deactivated}</b> deactiveren</button>
                <button type="button" className={`${comparison.conflicts ? 'warning ' : ''}${changeFilter === 'conflict' ? 'active' : ''}`} aria-pressed={changeFilter === 'conflict'} onClick={() => selectChangeFilter('conflict')}><b>{comparison.conflicts}</b> conflicten</button>
                <span><b>{comparison.unchanged}</b> ongewijzigd</span>
              </div>

              {contentComparison && (
                <div className={`content-comparison${contentComparison.missing ? ' warning' : ''}`}>
                  <strong>Programma en organisatie-inhoud</strong>
                  <span>{contentComparison.new} nieuw · {contentComparison.changed} gewijzigd · {contentComparison.unchanged} ongewijzigd</span>
                  {contentComparison.missing > 0 && <p><AlertTriangle aria-hidden="true" />{contentComparison.missing} bestaande ID’s ontbreken. Zet deze regels in Excel op actief = nee; verwijder ze niet.</p>}
                </div>
              )}

              {changes.length === 0 ? (
                <div className="comparison-empty"><CheckCircle2 aria-hidden="true" /><p><strong>Alles is actueel</strong>Er zijn geen wijzigingen ten opzichte van de database.</p></div>
              ) : (
                <>
                  <div className="comparison-tools">
                    <button type="button" className={changeFilter === 'all' ? 'active' : ''} aria-pressed={changeFilter === 'all'} onClick={() => selectChangeFilter('all')}>Alle mutaties <b>{changes.length}</b></button>
                    <label aria-label="Zoek in mutaties"><Search aria-hidden="true" /><input type="search" value={changeSearch} onChange={(event) => { setChangeSearch(event.target.value); setChangePage(0) }} placeholder="Zoek naam, nummer of klas" /></label>
                  </div>
                  <p className="comparison-range">{visibleChangeStart}-{visibleChangeEnd} van {filteredChanges.length} getoond</p>
                  {visibleChanges.length ? (
                    <ul className="comparison-list">
                      {visibleChanges.map((change, index) => (
                        <li key={`${change.status}-${change.profileId ?? change.identifier}-${index}`} className={change.status}>
                          <span className="comparison-status">{statusLabels[change.status]}</span>
                          <strong>{change.displayName}</strong>
                          <small>{change.identifier}</small>
                          <ChangeDetails change={change} incoming={change.row ? preview.rows[change.row - 2] : undefined} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="comparison-no-results">Geen mutaties gevonden met dit filter.</p>
                  )}
                  {changePageCount > 1 && (
                    <nav className="comparison-pagination" aria-label="Pagina's met mutaties">
                      <button type="button" onClick={() => setChangePage(Math.max(0, safeChangePage - 1))} disabled={safeChangePage === 0}><ChevronLeft aria-hidden="true" />Vorige</button>
                      <span>Pagina {safeChangePage + 1} van {changePageCount}</span>
                      <button type="button" onClick={() => setChangePage(Math.min(changePageCount - 1, safeChangePage + 1))} disabled={safeChangePage === changePageCount - 1}>Volgende<ChevronRight aria-hidden="true" /></button>
                    </nav>
                  )}
                </>
              )}

              {!appliedImport && <div className="comparison-stop"><ShieldCheck aria-hidden="true" /><p><strong>Controlepunt</strong>Bekijk de mutaties zorgvuldig. Tot je de tweede bevestigingsknop gebruikt, is er niets opgeslagen.</p></div>}

              {!appliedImport && comparison.conflicts > 0 && (
                <p className="comparison-blocked"><AlertTriangle aria-hidden="true" />Los eerst alle conflicten in Excel op en vergelijk het bestand daarna opnieuw.</p>
              )}

              {!appliedImport && contentComparison && contentComparison.missing > 0 && (
                <p className="comparison-blocked"><AlertTriangle aria-hidden="true" />Herstel eerst de ontbrekende inhoudsregels en vergelijk opnieuw.</p>
              )}

              {!appliedImport && comparison.conflicts === 0 && contentComparison?.missing === 0 && !confirming && (
                <button className="import-apply-button" onClick={() => setConfirming(true)}>
                  Controleer en verwerk definitief
                </button>
              )}

              {!appliedImport && comparison.conflicts === 0 && contentComparison?.missing === 0 && confirming && (
                <div className="import-confirm">
                  <AlertTriangle aria-hidden="true" />
                  <p><strong>Weet je het zeker?</strong>Hiermee worden personen én alle gecontroleerde programma-, locatie- en berichtgegevens in één transactie verwerkt.</p>
                  <div>
                    <button onClick={() => setConfirming(false)} disabled={applying}>Annuleren</button>
                    <button className="confirm" onClick={applyConfirmedImport} disabled={applying}>{applying ? 'Verwerken…' : 'Ja, definitief verwerken'}</button>
                  </div>
                </div>
              )}

              {appliedImport && (
                <div className="import-applied" role="status">
                  <CheckCircle2 aria-hidden="true" />
                  <p><strong>Masterbestand volledig verwerkt</strong>Importnummer {appliedImport.importId.slice(0, 8)}. Profielen en de nieuwe versie van alle organisatie-inhoud zijn samen opgeslagen.</p>
                </div>
              )}
            </section>
          )}

          {!comparison && <p className="panel-footnote">Na het vergelijken zie je eerst alle mutaties. Er wordt nog niets opgeslagen.</p>}
        </section>
      )}
    </>
  )
}
