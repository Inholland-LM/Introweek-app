import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, Image, LoaderCircle, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import type { MasterContent } from './import/parseWorkbook'
import type { AppProfile } from './profile'
import { createPovPhotoUrl, deletePovSubmission, fetchPovAssignmentUsage, fetchPovSubmissions, uploadPovPhoto, type PovAssignmentUsage, type PovSubmission } from './povUploads'

type Props = {
  profile: AppProfile
  assignments: MasterContent['povAssignments']
  fallbackUrl: string | null
}

function friendlyUploadError(reason: unknown) {
  const message = reason instanceof Error
    ? reason.message
    : reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string'
      ? reason.message
      : ''
  if (message.includes('maximumaantal') || message.includes('deadline') || message.includes('actief')) return message
  return message || 'De foto kon niet worden ingestuurd. Probeer het nogmaals.'
}

function ParticipantPovPanel({ profile, assignments, fallbackUrl }: Props) {
  const [assignmentId, setAssignmentId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [usage, setUsage] = useState<PovAssignmentUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')
  const selectedAssignment = assignments.find((item) => item.id === assignmentId)

  async function refreshUsage() {
    if (!selectedAssignment) return
    setUsageLoading(true)
    setUsageError('')
    try {
      setUsage(await fetchPovAssignmentUsage(selectedAssignment.id, selectedAssignment.maxUploads))
    } catch {
      setUsage(null)
      setUsageError('De actuele bezetting kon niet worden geladen.')
    } finally {
      setUsageLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedAssignment) {
      setUsage(null)
      setUsageError('')
      return
    }
    void refreshUsage()
    const refreshOnFocus = () => { void refreshUsage() }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [selectedAssignment?.id, selectedAssignment?.maxUploads])

  if (!assignments.length) {
    return fallbackUrl ? (
      <a className="primary-button more-link-button" href={fallbackUrl} target="_blank" rel="noreferrer">
        <span>Open POV-upload</span><ChevronRight aria-hidden="true" />
      </a>
    ) : <p className="panel-footnote">Er staat voor {profile.classCode} momenteel geen POV-opdracht open.</p>
  }

  if (!selectedAssignment) {
    return <div className="pov-category-list" aria-label="POV-categorieën">
      <p className="pov-category-intro">Kies eerst een categorie. Daarna zie je de opdracht en kun je een foto insturen voor jouw klas.</p>
      {assignments.map((assignment, index) => <button key={assignment.id} type="button" onClick={() => setAssignmentId(assignment.id)}>
        <span className="pov-category-number">{String(index + 1).padStart(2, '0')}</span>
        <span><strong>{assignment.title}</strong><small>Open categorie</small></span>
        <ChevronRight aria-hidden="true" />
      </button>)}
    </div>
  }

  async function submit() {
    if (!selectedAssignment || !file || !consent) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await uploadPovPhoto(selectedAssignment.id, file, caption, consent)
      setSuccess(`Foto ingestuurd voor “${selectedAssignment.title}” (${Math.max(1, Math.round(result.compressedBytes / 1024))} kB).`)
      setFile(null); setCaption(''); setConsent(false)
      await refreshUsage()
    } catch (reason) {
      setError(friendlyUploadError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pov-upload-flow">
      <button type="button" className="pov-category-back" onClick={() => setAssignmentId('')}><ArrowLeft aria-hidden="true" /> Alle categorieën</button>
      <div className="pov-assignment">
        {selectedAssignment && (
          <>
            <strong>{selectedAssignment.title}</strong>
            <p>{selectedAssignment.description}</p>
            <div className="pov-counter-badge">
              <Camera aria-hidden="true" />
              <span>{usageLoading
                ? 'Beschikbare plekken laden…'
                : usage
                  ? <><strong>{usage.used} van {usage.maximum} plekken gebruikt</strong><small>{usage.remaining === 0 ? 'Geen plekken meer beschikbaar voor jouw klas' : `Nog ${usage.remaining} ${usage.remaining === 1 ? 'plek' : 'plekken'} beschikbaar voor jouw klas`}</small></>
                  : `Maximaal ${selectedAssignment.maxUploads} foto’s per klas voor deze opdracht`}</span>
              <button type="button" onClick={() => { void refreshUsage() }} disabled={usageLoading} aria-label="Beschikbare POV-plekken vernieuwen"><RefreshCw className={usageLoading ? 'spin' : ''} aria-hidden="true" /></button>
            </div>
            {usageError && <small className="pov-usage-error">{usageError}</small>}
            <small>Insturen tot {new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectedAssignment.deadlineAt))}</small>
          </>
        )}
      </div>

      <label className="pov-file-button">
        <Upload aria-hidden="true" />
        <span>{file ? file.name : 'Kies een foto'}</span>
        <input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <label className="pov-caption">Bijschrift (optioneel)<textarea maxLength={240} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Wat zien we op deze foto?" /></label>
      <label className="pov-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Ik bevestig dat ik toestemming heb van herkenbare personen op de foto. Deze bevestiging wordt bij de inzending vastgelegd.</span></label>
      <p className="pov-privacy-note">De app bewaart een hoogwaardige versie voor jury en aftermovie. Alleen de organisatie kan ingestuurde foto’s bekijken.</p>
      {error && <div className="notification-state notification-error" role="alert">{error}</div>}
      {success && <div className="pov-success" role="status"><CheckCircle2 aria-hidden="true" />{success}</div>}
      <button className="primary-button pov-submit" type="button" disabled={!file || !consent || busy || usage?.remaining === 0} onClick={() => { void submit() }}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}<span>{busy ? 'Foto verwerken en insturen…' : usage?.remaining === 0 ? 'Geen plekken beschikbaar' : 'Foto insturen'}</span>
      </button>

    </div>
  )
}

function OrganizerPovPanel({ assignments }: Pick<Props, 'assignments'>) {
  const [submissions, setSubmissions] = useState<PovSubmission[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoTitle, setPhotoTitle] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return submissions
    return submissions.filter((item) => `${item.assignmentTitle} ${item.classCode} ${item.uploaderName} ${item.caption ?? ''}`.toLowerCase().includes(needle))
  }, [query, submissions])

  async function load() {
    setLoading(true); setError('')
    try {
      setSubmissions(await fetchPovSubmissions(0, 50)); setLoaded(true)
    } catch (reason) {
      setError(friendlyUploadError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function openPhoto(item: PovSubmission) {
    setError('')
    try {
      setPhotoTitle(`${item.assignmentTitle} · ${item.classCode} · ${item.uploaderName}`)
      setPhotoUrl(await createPovPhotoUrl(item.storagePath))
    } catch (reason) {
      setError(friendlyUploadError(reason))
    }
  }

  async function remove(item: PovSubmission) {
    if (!window.confirm(`Foto “${item.assignmentTitle}” van ${item.uploaderName} definitief verwijderen?`)) return
    setLoading(true); setError('')
    try {
      await deletePovSubmission(item.id)
      setSubmissions((current) => current.filter((submission) => submission.id !== item.id))
      if (photoTitle.includes(item.uploaderName)) { setPhotoUrl(''); setPhotoTitle('') }
    } catch (reason) { setError(friendlyUploadError(reason)) } finally { setLoading(false) }
  }

  return (
    <div className="pov-organizer">
      <div className="info-callout"><strong>{assignments.length} actieve opdracht{assignments.length === 1 ? '' : 'en'}</strong><p>Foto’s worden niet automatisch geladen. Dat houdt dataverbruik en egress laag.</p></div>
      <button className="primary-button pov-load" type="button" onClick={() => { void load() }} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Image />}<span>{loaded ? 'Ververs inzendingen' : 'Laad laatste 50 inzendingen'}</span></button>
      {error && <div className="notification-state notification-error" role="alert">{error}</div>}
      {loaded && <>
        <input className="pov-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek op klas, naam of opdracht" />
        <small className="pov-result-count">{filtered.length} van {submissions.length} getoond</small>
        <ul className="pov-submission-list">
          {filtered.map((item) => <li key={item.id}><div><strong>{item.assignmentTitle}</strong><span>{item.classCode} · {item.uploaderName}</span>{item.caption && <p>{item.caption}</p>}<small>{new Intl.DateTimeFormat('nl-NL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.uploadedAt))}</small></div><span className="pov-organizer-actions"><button type="button" onClick={() => { void openPhoto(item) }}>Bekijk foto</button><button type="button" className="danger" onClick={() => { void remove(item) }}><Trash2 aria-hidden="true" /> Verwijder</button></span></li>)}
        </ul>
        {!filtered.length && <p className="panel-footnote">Geen inzendingen gevonden.</p>}
      </>}
      {photoUrl && <div className="pov-photo-modal" role="dialog" aria-modal="true" aria-label={photoTitle}><button type="button" onClick={() => setPhotoUrl('')} aria-label="Foto sluiten"><X /></button><img src={photoUrl} alt={photoTitle} /><strong>{photoTitle}</strong></div>}
    </div>
  )
}

export function PovPanel(props: Props) {
  return props.profile.profileType === 'organizer'
    ? <OrganizerPovPanel assignments={props.assignments} />
    : <ParticipantPovPanel {...props} />
}
