import { useState, type ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ShieldCheck, Upload, UsersRound } from 'lucide-react'
import { parseImportWorkbook, type ImportPreview } from './parseWorkbook'

export function ImportPreviewPanel() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setLoading(true)
    setError('')
    setPreview(null)
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
            <div className="import-ready"><CheckCircle2 aria-hidden="true" /><p><strong>Klaar voor vergelijking</strong>Studenten {roleCounts.student ?? 0} · buddy’s {roleCounts.buddy ?? 0} · PO’ers {roleCounts.poer ?? 0} · organisatoren {roleCounts.organizer ?? 0}</p></div>
          ) : (
            <div className="import-issues">
              <h3><AlertTriangle aria-hidden="true" />Los dit eerst op</h3>
              <ul>{preview.issues.slice(0, 12).map((issue, index) => <li key={`${issue.row}-${issue.message}-${index}`}><b>Rij {issue.row}</b><span>{issue.message}</span></li>)}</ul>
              {preview.issues.length > 12 && <p>En nog {preview.issues.length - 12} problemen.</p>}
            </div>
          )}

          <p className="panel-footnote">De knop om mutaties te vergelijken en te bevestigen volgt in de volgende beveiligde stap.</p>
        </section>
      )}
    </>
  )
}
