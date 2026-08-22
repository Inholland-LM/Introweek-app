import { supabase } from './lib/supabase'

const bucketName = 'pov-inzendingen'
const maximumPhotoDimension = 2560
const maximumUploadBytes = 2 * 1024 * 1024

export type PovSubmission = {
  id: string
  assignmentId: string
  assignmentTitle: string
  classCode: string
  uploaderName: string
  storagePath: string
  caption: string | null
  byteSize: number
  uploadedAt: string
  reviewStatus: 'pending' | 'approved' | 'rejected'
  rejectionReason: string | null
  awardedPoints: number
  consentConfirmed: boolean
  consentConfirmedAt: string | null
  consentVersion: string | null
}

export type PovAssignmentUsage = {
  used: number
  maximum: number
  remaining: number
  deadlineAt: string | null
}

function mapPovSubmission(item: Record<string, unknown>): PovSubmission {
  return {
    id: String(item.id),
    assignmentId: String(item.assignment_id),
    assignmentTitle: String(item.assignment_title),
    classCode: String(item.class_code),
    uploaderName: String(item.uploader_name),
    storagePath: String(item.storage_path ?? ''),
    caption: item.caption ? String(item.caption) : null,
    byteSize: Number(item.byte_size ?? 0),
    uploadedAt: String(item.uploaded_at),
    reviewStatus: item.review_status === 'approved' || item.review_status === 'rejected' ? item.review_status : 'pending',
    rejectionReason: item.rejection_reason ? String(item.rejection_reason) : null,
    awardedPoints: Number(item.awarded_points ?? 0),
    consentConfirmed: item.consent_confirmed === true,
    consentConfirmedAt: item.consent_confirmed_at ? String(item.consent_confirmed_at) : null,
    consentVersion: item.consent_version ? String(item.consent_version) : null,
  }
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('De foto kon niet worden verkleind.')), 'image/jpeg', quality)
  })
}

export async function compressPovPhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Kies een foto in JPG, PNG, WebP of een ander formaat dat jouw browser ondersteunt.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Deze foto is groter dan 20 MB. Kies een kleinere foto.')

  const image = await loadImage(file)
  let scale = Math.min(1, maximumPhotoDimension / Math.max(image.naturalWidth, image.naturalHeight))
  let quality = 0.88

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('De foto kan op dit apparaat niet worden verwerkt.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await canvasBlob(canvas, quality)
    if (blob.size <= maximumUploadBytes) return blob
    quality = Math.max(0.68, quality - 0.04)
    if (quality <= 0.72) scale *= 0.9
  }

  throw new Error('De foto blijft na verkleinen te groot. Kies een foto met een lagere resolutie.')
}

export async function uploadPovPhoto(assignmentId: string, file: File, caption: string, consentConfirmed: boolean) {
  if (!supabase) throw new Error('De beveiligde uploadverbinding is niet beschikbaar.')
  if (!consentConfirmed) throw new Error('Bevestig eerst de toestemming van herkenbare personen op de foto.')
  const compressed = await compressPovPhoto(file)
  const { data: reservation, error: reserveError } = await supabase.rpc('prepare_pov_upload', {
    requested_assignment_id: assignmentId,
  })
  if (reserveError) throw reserveError

  const parsed = reservation as { id?: string; path?: string }
  if (!parsed.id || !parsed.path) throw new Error('De upload kon niet veilig worden gereserveerd.')

  const { error: uploadError } = await supabase.storage.from(bucketName).upload(parsed.path, compressed, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  })
  if (uploadError) {
    await supabase.rpc('cancel_pov_upload', { requested_submission_id: parsed.id })
    throw uploadError
  }

  const { error: completeError } = await supabase.rpc('complete_pov_upload', {
    requested_submission_id: parsed.id,
    submitted_caption: caption,
    submitted_original_filename: file.name,
    submitted_byte_size: compressed.size,
    submitted_mime_type: 'image/jpeg',
    submitted_consent_confirmed: consentConfirmed,
  })
  if (completeError) {
    await supabase.storage.from(bucketName).remove([parsed.path])
    await supabase.rpc('cancel_pov_upload', { requested_submission_id: parsed.id })
    throw completeError
  }

  return { id: parsed.id, compressedBytes: compressed.size }
}

export async function fetchPovAssignmentUsage(assignmentId: string, fallbackMaximum: number): Promise<PovAssignmentUsage> {
  const safeMaximum = Math.max(1, fallbackMaximum)
  if (!supabase) return { used: 0, maximum: safeMaximum, remaining: safeMaximum, deadlineAt: null }
  const { data, error } = await supabase.rpc('get_my_pov_assignment_usage', {
    requested_assignment_id: assignmentId,
  })
  if (error) throw error
  const item = (data ?? {}) as Record<string, unknown>
  const maximum = Math.max(1, Number(item.maximum ?? safeMaximum))
  const used = Math.max(0, Math.min(maximum, Number(item.used ?? 0)))
  return {
    used,
    maximum,
    remaining: Math.max(0, Number(item.remaining ?? maximum - used)),
    deadlineAt: item.deadlineAt ? String(item.deadlineAt) : null,
  }
}

export async function fetchPovSubmissions(offset = 0, limit = 50) {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('list_pov_submissions_v2', {
    requested_limit: limit,
    requested_offset: offset,
  })
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapPovSubmission)
}

export async function createPovPhotoUrl(storagePath: string) {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { data, error } = await supabase.storage.from(bucketName).createSignedUrl(storagePath, 300)
  if (error) throw error
  return data.signedUrl
}

export async function reviewPovSubmission(id: string, status: 'approved' | 'rejected', reason = '') {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { error } = await supabase.rpc('review_pov_submission', {
    requested_submission_id: id,
    requested_review_status: status,
    requested_rejection_reason: reason,
  })
  if (error) throw error
}

export async function approvePovSubmissionWithPoints(id: string, points: number) {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('review_pov_submission_with_points', {
    requested_submission_id: id,
    requested_points: points,
  })
  if (error) throw error

  const result = data as { scoreVersion?: number }
  window.dispatchEvent(new CustomEvent('competition-score-changed', { detail: result }))
  const channel = supabase.channel('competition-score-updates')
  await channel.send({ type: 'broadcast', event: 'score-changed', payload: result })
  await supabase.removeChannel(channel)
  return result
}

export async function deletePovSubmission(id: string) {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('delete_pov_submission', { requested_submission_id: id })
  if (error) throw error
  const storagePath = String(data ?? '')
  if (!storagePath) throw new Error('Het opslagpad van de foto ontbreekt.')
  const { error: storageError } = await supabase.storage.from(bucketName).remove([storagePath])
  if (storageError) throw storageError
}
