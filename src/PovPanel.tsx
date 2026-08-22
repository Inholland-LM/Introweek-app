import { useMemo, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, Image, LoaderCircle, Trash2, Upload, X } from 'lucide-react'
import type { MasterContent } from './import/parseWorkbook'
import type { AppProfile } from './profile'
import { createPovPhotoUrl, deletePovSubmission, fetchPovSubmissions, uploadPovPhoto, type PovSubmission } from './povUploads'

type Props = {
  profile: AppProfile
  assignments: MasterContent['povAssignments']
  fallbackUrl: string | null
}

function friendlyUploadError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : ''
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
  const selectedAssignment = assignments.find((item) => item.id === assignmentId)

  if (!assignments.length) {
    return fallbackUrl ? (
      <a className="primary-button more-link-button" href={fallbackUrl} target="_blank" rel="noreferrer">
        <span>Open POV-upload</span><ChevronRight aria-hidden="true" />
      </a>
    ) : <p className="panel-footnote">Er staat voor {profile.classCode} momenteel geen POV-opdracht open.</p>
  }

  if (!selectedAssignment) {
    return <div className="pov-category-list" aria-label="POV-categorieën">
      <p className="pov-category-intro">Kies eerst een categorie. Daarna zie je de opdracht, de inzendingen van jouw klas en de uploadmogelijkheid.</p>
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
      const result = await uploadPovPhoto(selectedAssignment.id, file, caption)
      setSuccess(`Foto ingestuurd voor “${selectedAssignment.title}” (${Math.max(1, Math.round(result.compressedBytes / 1024))} kB).`)
      setFile(null); setCaption(''); setConsent(false)
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
              <span>Maximaal {selectedAssignment.maxUploads} foto’s per klas voor deze opdracht</span>
            </div>
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
      <label className="pov-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Ik heb toestemming van herkenbare personen op de foto.</span></label>
      <p className="pov-privacy-note">De app bewaart een hoogwaardige versie voor jury en aftermovie. Alleen de organisatie kan ingestuurde foto’s bekijken.</p>
      {error && <div className="notification-state notification-error" role="alert">{error}</div>}
      {success && <div className="pov-success" role="status"><CheckCircle2 aria-hidden="true" />{success}</div>}
      <button className="primary-button pov-submit" type="button" disabled={!file || !consent || busy} onClick={() => { void submit() }}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}<span>{busy ? 'Foto verwerken en insturen…' : 'Foto insturen'}</span>
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
