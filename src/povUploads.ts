import { supabase } from './lib/supabase'

const bucketName = 'pov-inzendingen'
const maximumPhotoDimension = 800
const maximumUploadBytes = 100_000

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
  let quality = 0.82

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
    quality = Math.max(0.48, quality - 0.06)
    scale *= 0.92
  }

  throw new Error('De foto blijft na verkleinen te groot. Kies een foto met een lagere resolutie.')
}

export async function uploadPovPhoto(assignmentId: string, file: File, caption: string) {
  if (!supabase) throw new Error('De beveiligde uploadverbinding is niet beschikbaar.')
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
  })
  if (completeError) {
    await supabase.storage.from(bucketName).remove([parsed.path])
    await supabase.rpc('cancel_pov_upload', { requested_submission_id: parsed.id })
    throw completeError
  }

  return { id: parsed.id, compressedBytes: compressed.size }
}

export async function fetchPovSubmissions(offset = 0, limit = 50) {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('list_pov_submissions', {
    requested_limit: limit,
    requested_offset: offset,
  })
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    id: String(item.id),
    assignmentId: String(item.assignment_id),
    assignmentTitle: String(item.assignment_title),
    classCode: String(item.class_code),
    uploaderName: String(item.uploader_name),
    storagePath: String(item.storage_path),
    caption: item.caption ? String(item.caption) : null,
    byteSize: Number(item.byte_size ?? 0),
    uploadedAt: String(item.uploaded_at),
  })) satisfies PovSubmission[]
}

export async function createPovPhotoUrl(storagePath: string) {
  if (!supabase) throw new Error('De beveiligde verbinding is niet beschikbaar.')
  const { data, error } = await supabase.storage.from(bucketName).createSignedUrl(storagePath, 300)
  if (error) throw error
  return data.signedUrl
}

export async function fetchClassPovSubmissionCount(assignmentId: string) {
  if (!supabase) return 0
  try {
    const { count, error } = await supabase
      .from('pov_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('assignment_id', assignmentId)
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}
