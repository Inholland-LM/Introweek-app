import { supabase } from '../lib/supabase'
import type { ImportPerson } from './parseWorkbook'

export type ImportChangeStatus = 'new' | 'changed' | 'conflict' | 'deactivated'

export type ImportChange = {
  row?: number
  status: ImportChangeStatus
  profileId: string | null
  displayName: string
  identifier: string
  classCode: string | null
  fields: string[]
}

export type ImportComparison = {
  totalIncoming: number
  new: number
  changed: number
  unchanged: number
  conflicts: number
  deactivated: number
  changes: ImportChange[]
  deactivations: ImportChange[]
  generatedAt: string
}

export async function comparePeopleImport(rows: ImportPerson[]) {
  if (!supabase) throw new Error('De beveiligde databaseverbinding is nog niet geconfigureerd.')

  const { data, error } = await supabase.rpc('preview_people_import', { import_rows: rows })
  if (error) {
    if (error.code === '42501') throw new Error('Alleen een actieve organisator mag deelnemers vergelijken.')
    if (error.code === 'PGRST202' || error.message.includes('preview_people_import')) {
      throw new Error('De importvergelijking is nog niet in Supabase geactiveerd.')
    }
    throw new Error('Vergelijken lukt nu niet. Het bestand is niet verwerkt; probeer het later opnieuw.')
  }

  return data as ImportComparison
}
