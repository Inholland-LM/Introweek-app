import { supabase } from '../lib/supabase'
import type { ImportPerson, MasterContent } from './parseWorkbook'

export type ImportChangeStatus = 'new' | 'changed' | 'conflict' | 'deactivated'

export type ImportPreviousValues = {
  firstName: string
  namePrefix: string | null
  lastName: string
  email: string
  role: ImportPerson['role']
  classCode: string | null
  active: boolean
}

export type ImportChange = {
  row?: number
  status: ImportChangeStatus
  profileId: string | null
  displayName: string
  identifier: string
  classCode: string | null
  fields: string[]
  previousValues?: ImportPreviousValues | null
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
  stateVersion: string
}

export type AppliedImport = ImportComparison & {
  importId: string
  appliedAt: string
}

export type ContentChange = {
  section: keyof Omit<MasterContent, 'settings'> | 'settings'
  id: string
  status: 'new' | 'changed' | 'missing'
}

export type ContentComparison = {
  version: number
  new: number
  changed: number
  missing: number
  unchanged: number
  changes: ContentChange[]
}

export type MasterComparison = {
  people: ImportComparison
  content: ContentComparison
}

function compareContent(current: Partial<MasterContent>, incoming: MasterContent, version: number): ContentComparison {
  const changes: ContentChange[] = []
  let unchanged = 0
  const sections: Array<keyof Omit<MasterContent, 'settings'>> = ['classes', 'locations', 'programmes', 'messages', 'povAssignments', 'practical', 'discounts']

  for (const section of sections) {
    const currentItems = new Map(((current[section] ?? []) as Array<{ id?: string; classCode?: string }>).map((item) => [item.id ?? item.classCode ?? '', item]))
    const incomingItems = new Map((incoming[section] as Array<{ id?: string; classCode?: string }>).map((item) => [item.id ?? item.classCode ?? '', item]))
    incomingItems.forEach((item, id) => {
      const previous = currentItems.get(id)
      if (!previous) changes.push({ section, id, status: 'new' })
      else if (JSON.stringify(previous) !== JSON.stringify(item)) changes.push({ section, id, status: 'changed' })
      else unchanged += 1
    })
    currentItems.forEach((_item, id) => {
      if (!incomingItems.has(id)) changes.push({ section, id, status: 'missing' })
    })
  }

  if (JSON.stringify(current.settings ?? {}) !== JSON.stringify(incoming.settings)) {
    changes.push({ section: 'settings', id: 'algemene instellingen', status: Object.keys(current.settings ?? {}).length ? 'changed' : 'new' })
  } else unchanged += 1

  return {
    version,
    new: changes.filter((item) => item.status === 'new').length,
    changed: changes.filter((item) => item.status === 'changed').length,
    missing: changes.filter((item) => item.status === 'missing').length,
    unchanged,
    changes,
  }
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

export async function applyPeopleImport(rows: ImportPerson[], stateVersion: string) {
  if (!supabase) throw new Error('De beveiligde databaseverbinding is nog niet geconfigureerd.')

  const { data, error } = await supabase.rpc('apply_people_import', {
    import_rows: rows,
    expected_state_version: stateVersion,
  })

  if (error) {
    if (error.code === '42501') throw new Error('Alleen een actieve organisator mag deelnemers verwerken.')
    if (error.code === '40001') throw new Error('De gegevens zijn intussen gewijzigd. Vergelijk het bestand opnieuw voordat je bevestigt.')
    if (error.code === 'PGRST202' || error.message.includes('apply_people_import')) {
      throw new Error('Definitief verwerken is nog niet in Supabase geactiveerd.')
    }
    throw new Error('Verwerken is niet gelukt. Er is niets gewijzigd; probeer het later opnieuw.')
  }

  return data as AppliedImport
}

export async function compareMasterImport(rows: ImportPerson[], content: MasterContent): Promise<MasterComparison> {
  if (!supabase) throw new Error('De beveiligde databaseverbinding is nog niet geconfigureerd.')
  const [people, contentResponse] = await Promise.all([
    comparePeopleImport(rows),
    supabase.rpc('get_app_content'),
  ])
  if (contentResponse.error) {
    if (contentResponse.error.code === 'PGRST202') throw new Error('De masterinhoud-import is nog niet in Supabase geactiveerd.')
    throw new Error('De huidige programma-inhoud kon niet veilig worden vergeleken.')
  }
  const current = (contentResponse.data ?? {}) as { version?: number; content?: Partial<MasterContent> }
  return { people, content: compareContent(current.content ?? {}, content, Number(current.version ?? 0)) }
}

export async function applyMasterImport(rows: ImportPerson[], peopleStateVersion: string, content: MasterContent, contentVersion: number) {
  if (!supabase) throw new Error('De beveiligde databaseverbinding is nog niet geconfigureerd.')
  const { data, error } = await supabase.rpc('apply_master_import', {
    import_rows: rows,
    expected_people_state_version: peopleStateVersion,
    imported_content: content,
    expected_content_version: contentVersion,
  })
  if (error) {
    if (error.code === '42501') throw new Error('Alleen een actieve organisator mag het masterbestand verwerken.')
    if (error.code === '40001') throw new Error('De gegevens zijn intussen gewijzigd. Vergelijk het bestand opnieuw.')
    if (error.code === 'PGRST202') throw new Error('De masterinhoud-import is nog niet in Supabase geactiveerd.')
    throw new Error('Verwerken is niet gelukt. De volledige transactie is teruggedraaid.')
  }
  return data as { people: AppliedImport; contentVersion: number; contentHash: string }
}
