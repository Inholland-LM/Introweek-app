import { supabase } from './lib/supabase'

export type ImageConsent = {
  consent: boolean
  consentVersion: string
  decidedAt: string
  updatedAt: string
}

const consentVersion = '2026-08-15-v1'
const demoKey = 'lm-you-image-consent:v1'

function mapConsent(value: Record<string, unknown>): ImageConsent {
  return {
    consent: Boolean(value.consent),
    consentVersion: String(value.consent_version ?? consentVersion),
    decidedAt: String(value.decided_at ?? new Date().toISOString()),
    updatedAt: String(value.updated_at ?? new Date().toISOString()),
  }
}

export async function fetchMyImageConsent(): Promise<ImageConsent | null> {
  if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true') {
    try { return JSON.parse(localStorage.getItem(demoKey) ?? 'null') as ImageConsent | null } catch { return null }
  }
  const { data, error } = await supabase.rpc('get_my_image_consent')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? mapConsent(row as Record<string, unknown>) : null
}

export async function saveMyImageConsent(consent: boolean): Promise<ImageConsent> {
  if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true') {
    const now = new Date().toISOString()
    const value = { consent, consentVersion, decidedAt: now, updatedAt: now }
    localStorage.setItem(demoKey, JSON.stringify(value))
    return value
  }
  const { data, error } = await supabase.rpc('set_my_image_consent', {
    requested_consent: consent,
    requested_version: consentVersion,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('De AVG-keuze kon niet worden bevestigd.')
  return mapConsent(row as Record<string, unknown>)
}
