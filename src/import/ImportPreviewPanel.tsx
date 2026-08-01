import { useState, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, FileSpreadsheet, ShieldCheck, Upload, UsersRound } from 'lucide-react'
import { comparePeopleImport, type ImportComparison, type ImportChangeStatus } from './compareImport'
import { parseImportWorkbook, type ImportPreview } from './parseWorkbook'

const statusLabels: Record<ImportChangeStatus, string> = {
  new: 'Nieuw',
  changed: 'Gewijzigd',
  conflict: 'Conflict',
  deactivated: 'Deactiveren',
}

export function ImportPreviewPanel() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<ImportComparison | null>(null)

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setLoading(true)
    setError('')
    setPreview(null)
    setComparison(null)
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

  async function compareWithCurrentData() {
    if (!preview || !ready) return
    setComparing(true)
    setError('')
    setComparison(null)
    try {
      setComparison(await comparePeopleImport(preview.rows))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vergelijken lukt nu niet.')
    } finally {
      setComparing(false)
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

          {ready ? (
            <>
              <div className="import-ready"><CheckCircle2 aria-hidden="true" /><p><strong>Klaar voor vergelijking</strong>Studenten {roleCounts.student ?? 0} · buddy’s {roleCounts.buddy ?? 0} · PO’ers {roleCounts.poer ?? 0} · organisatoren {roleCounts.organizer ?? 0}</p></div>
              <button className="import-compare-button" onClick={compareWithCurrentData} disabled={comparing}>
                <span>{comparing ? 'Veilig vergelijken…' : 'Vergelijk met huidige gegevens'}</span><ArrowRight aria-hidden="true" />
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
                <span><b>{comparison.new}</b> nieuw</span>
                <span><b>{comparison.changed}</b> gewijzigd</span>
                <span><b>{comparison.deactivated}</b> deactiveren</span>
                <span className={comparison.conflicts ? 'warning' : ''}><b>{comparison.conflicts}</b> conflicten</span>
                <span><b>{comparison.unchanged}</b> ongewijzigd</span>
              </div>

              {changes.length === 0 ? (
                <div className="comparison-empty"><CheckCircle2 aria-hidden="true" /><p><strong>Alles is actueel</strong>Er zijn geen wijzigingen ten opzichte van de database.</p></div>
              ) : (
                <ul className="comparison-list">
                  {changes.map((change, index) => (
                    <li key={`${change.status}-${change.profileId ?? change.identifier}-${index}`} className={change.status}>
                      <span className="comparison-status">{statusLabels[change.status]}</span>
                      <strong>{change.displayName}</strong>
                      <small>{change.identifier}{change.classCode ? ` · ${change.classCode}` : ''}</small>
                      {change.fields.length > 0 && <p>{change.fields.join(' · ')}</p>}
                    </li>
                  ))}
                </ul>
              )}

              <div className="comparison-stop"><ShieldCheck aria-hidden="true" /><p><strong>Voorvertoning afgerond</strong>Er is niets opgeslagen. Definitief bevestigen bouwen en testen we als aparte vervolgstap.</p></div>
            </section>
          )}

          {!comparison && <p className="panel-footnote">Na het vergelijken zie je eerst alle mutaties. Er wordt nog niets opgeslagen.</p>}
        </section>
      )}
    </>
  )
}
