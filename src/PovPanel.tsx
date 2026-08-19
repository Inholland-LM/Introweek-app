import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, Image, LoaderCircle, Trash2, Upload, X } from 'lucide-react'
import type { MasterContent } from './import/parseWorkbook'
import type { AppProfile } from './profile'
import { createPovPhotoUrl, deletePovSubmission, fetchClassPovSubmissions, fetchPovSubmissions, uploadPovPhoto, type PovSubmission } from './povUploads'

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

const reviewLabels: Record<PovSubmission['reviewStatus'], string> = {
  pending: 'In afwachting',
  approved: 'Goedgekeurd',
  rejected: 'Afgekeurd',
}

function ClassPovCard({ item, onOpen }: { item: PovSubmission; onOpen: (item: PovSubmission, url: string) => void }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!item.storagePath) return
    let active = true
    createPovPhotoUrl(item.storagePath)
      .then((signedUrl) => { if (active) setUrl(signedUrl) })
      .catch(() => { if (active) setUrl('') })
    return () => { active = false }
  }, [item.storagePath])

  return (
    <article className={`class-submission-card status-${item.reviewStatus}`}>
      <button type="button" className="class-submission-photo" disabled={!url} onClick={() => onOpen(item, url)}>
        {url ? <img src={url} alt={item.caption || item.assignmentTitle} loading="lazy" /> : <Image aria-hidden="true" />}
      </button>
      <div className="class-submission-info">
        <span className={`pov-review-status status-${item.reviewStatus}`}>{reviewLabels[item.reviewStatus]}{item.reviewStatus === 'approved' ? ` · +${item.awardedPoints} punten` : ''}</span>
        <strong>{item.uploaderName}</strong>
        {item.caption && <p>{item.caption}</p>}
        {item.reviewStatus === 'rejected' && item.rejectionReason && <small>{item.rejectionReason}</small>}
      </div>
    </article>
  )
}

function ParticipantPovPanel({ profile, assignments, fallbackUrl }: Props) {
  const [assignmentId, setAssignmentId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submissions, setSubmissions] = useState<PovSubmission[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoTitle, setPhotoTitle] = useState('')
  const selectedAssignment = assignments.find((item) => item.id === assignmentId)
  const submittedCount = submissions.filter((item) => item.reviewStatus !== 'rejected').length
  const remainingCount = Math.max(0, (selectedAssignment?.maxUploads ?? 0) - submittedCount)

  useEffect(() => {
    if (!selectedAssignment) return
    let active = true
    setGalleryLoading(true)
    fetchClassPovSubmissions(selectedAssignment.id)
      .then((items) => { if (active) setSubmissions(items) })
      .catch((reason) => { if (active) setError(friendlyUploadError(reason)) })
      .finally(() => { if (active) setGalleryLoading(false) })
    return () => { active = false }
  }, [selectedAssignment?.id])

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
      setSubmissions(await fetchClassPovSubmissions(selectedAssignment.id))
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
              <span>{submittedCount} van max. {selectedAssignment.maxUploads} foto's ingestuurd door {profile.classCode}</span>
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
      <p className="pov-privacy-note">De app verkleint de foto vóór verzending. De organisatie bekijkt iedere foto eerst; pas na goedkeuring kan jouw klas de foto openen.</p>
      {error && <div className="notification-state notification-error" role="alert">{error}</div>}
      {success && <div className="pov-success" role="status"><CheckCircle2 aria-hidden="true" />{success}</div>}
      <button className="primary-button pov-submit" type="button" disabled={!file || !consent || busy} onClick={() => { void submit() }}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}<span>{busy ? 'Foto verwerken en insturen…' : 'Foto insturen'}</span>
      </button>

      {/* Klas Inzendingen & Status Overzicht */}
      <div className="class-submissions-section">
        <div className="class-submissions-heading">
          <div><h3>Inzendingen van {profile.classCode}</h3><p>{remainingCount} {remainingCount === 1 ? 'plek' : 'plekken'} over</p></div>
          <button type="button" onClick={() => {
            if (!selectedAssignment) return
            setGalleryLoading(true)
            fetchClassPovSubmissions(selectedAssignment.id)
              .then(setSubmissions)
              .catch((reason) => setError(friendlyUploadError(reason)))
              .finally(() => setGalleryLoading(false))
          }} disabled={galleryLoading}>{galleryLoading ? 'Laden…' : 'Ververs'}</button>
        </div>
        {galleryLoading && !submissions.length ? <p className="panel-footnote">Klasgalerij laden…</p> : submissions.length === 0 ? (
          <p className="panel-footnote">Er zijn nog geen foto's voor deze opdracht ingestuurd door {profile.classCode}.</p>
        ) : (
          <div className="class-submissions-grid">
            {submissions.map((item) => <ClassPovCard key={item.id} item={item} onOpen={(submission, url) => {
              setPhotoTitle(`${submission.assignmentTitle} · ${submission.uploaderName}`)
              setPhotoUrl(url)
            }} />)}
          </div>
        )}
      </div>
      {photoUrl && <div className="pov-photo-modal" role="dialog" aria-modal="true" aria-label={photoTitle}><button type="button" onClick={() => setPhotoUrl('')} aria-label="Foto sluiten"><X /></button><div className="pov-photo-zoom"><img src={photoUrl} alt={photoTitle} /></div><strong>{photoTitle}</strong></div>}
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
