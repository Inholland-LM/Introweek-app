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
  previousValue?: unknown
  incomingValue?: unknown
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
  currentContent: MasterContent
}

export type PeopleMutationAction = 'apply' | 'keep' | 'skip' | 'deactivate'
export type ContentMutationAction = 'apply' | 'keep' | 'skip' | 'remove'

function compareContent(current: Partial<MasterContent>, incoming: MasterContent, version: number): ContentComparison {
  const changes: ContentChange[] = []
  let unchanged = 0
  const sections: Array<keyof Omit<MasterContent, 'settings'>> = ['classes', 'locations', 'programmes', 'messages', 'povAssignments', 'practical', 'discounts']

  for (const section of sections) {
    const currentItems = new Map(((current[section] ?? []) as Array<{ id?: string; classCode?: string }>).map((item) => [item.id ?? item.classCode ?? '', item]))
    const incomingItems = new Map((incoming[section] as Array<{ id?: string; classCode?: string }>).map((item) => [item.id ?? item.classCode ?? '', item]))
    incomingItems.forEach((item, id) => {
      const previous = currentItems.get(id)
      if (!previous) changes.push({ section, id, status: 'new', incomingValue: item })
      else if (JSON.stringify(previous) !== JSON.stringify(item)) changes.push({ section, id, status: 'changed', previousValue: previous, incomingValue: item })
      else unchanged += 1
    })
    currentItems.forEach((_item, id) => {
      if (!incomingItems.has(id)) changes.push({ section, id, status: 'missing', previousValue: _item })
    })
  }

  if (JSON.stringify(current.settings ?? {}) !== JSON.stringify(incoming.settings)) {
    changes.push({
      section: 'settings',
      id: 'algemene instellingen',
      status: Object.keys(current.settings ?? {}).length ? 'changed' : 'new',
      previousValue: current.settings ?? {},
      incomingValue: incoming.settings,
    })
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
  const currentContent = {
    classes: current.content?.classes ?? [],
    locations: current.content?.locations ?? [],
    programmes: current.content?.programmes ?? [],
    messages: current.content?.messages ?? [],
    povAssignments: current.content?.povAssignments ?? [],
    practical: current.content?.practical ?? [],
    discounts: current.content?.discounts ?? [],
    settings: current.content?.settings ?? {},
  } satisfies MasterContent
  return { people, content: compareContent(currentContent, content, Number(current.version ?? 0)), currentContent }
}

export function peopleMutationKey(change: ImportChange) {
  return `${change.status}:${change.profileId ?? `row-${change.row ?? change.identifier}`}`
}

export function contentMutationKey(change: ContentChange) {
  return `${change.section}:${change.id}`
}

function previousPerson(change: ImportChange): ImportPerson | null {
  const previous = change.previousValues
  if (!previous) return null
  return {
    studentNumber: previous.role === 'student' || previous.role === 'buddy' ? change.identifier : null,
    firstName: previous.firstName,
    namePrefix: previous.namePrefix,
    lastName: previous.lastName,
    email: previous.email,
    role: previous.role,
    classCode: previous.classCode,
    active: previous.active,
  }
}

export function resolvePeopleMutations(
  incoming: ImportPerson[],
  comparison: ImportComparison,
  actions: Record<string, PeopleMutationAction>,
) {
  const rows = [...incoming]
  const omittedRows = new Set<number>()
  const replacements = new Map<number, ImportPerson>()

  comparison.changes.forEach((change) => {
    if (!change.row || change.status === 'conflict') return
    const index = change.row - 2
    const action = actions[peopleMutationKey(change)]
    if (change.status === 'new' && action === 'skip') omittedRows.add(index)
    if (change.status === 'changed' && action === 'keep') {
      const previous = previousPerson(change)
      if (previous) replacements.set(index, previous)
    }
  })

  const resolved = rows
    .map((row, index) => replacements.get(index) ?? row)
    .filter((_row, index) => !omittedRows.has(index))

  comparison.deactivations.forEach((change) => {
    if (actions[peopleMutationKey(change)] !== 'keep') return
    const previous = previousPerson(change)
    if (previous) resolved.push(previous)
  })

  return resolved
}

export function resolveContentMutations(
  incoming: MasterContent,
  current: MasterContent,
  comparison: ContentComparison,
  actions: Record<string, ContentMutationAction>,
) {
  const result = structuredClone(incoming)
  const sections: Array<keyof Omit<MasterContent, 'settings'>> = ['classes', 'locations', 'programmes', 'messages', 'povAssignments', 'practical', 'discounts']

  sections.forEach((section) => {
    const idFor = (item: { id?: string; classCode?: string }) => item.id ?? item.classCode ?? ''
    const incomingItems = new Map((incoming[section] as Array<{ id?: string; classCode?: string }>).map((item) => [idFor(item), item]))
    const currentItems = new Map((current[section] as Array<{ id?: string; classCode?: string }>).map((item) => [idFor(item), item]))
    comparison.changes.filter((change) => change.section === section).forEach((change) => {
      const action = actions[contentMutationKey(change)]
      if ((change.status === 'new' && action === 'skip') || (change.status === 'missing' && action === 'remove')) incomingItems.delete(change.id)
      if ((change.status === 'changed' || change.status === 'missing') && action === 'keep') {
        const previous = currentItems.get(change.id)
        if (previous) incomingItems.set(change.id, previous)
      }
    })
    Object.assign(result, { [section]: Array.from(incomingItems.values()) })
  })

  const settingsChange = comparison.changes.find((change) => change.section === 'settings')
  if (settingsChange && ['keep', 'skip'].includes(actions[contentMutationKey(settingsChange)])) result.settings = current.settings
  validateResolvedContent(result)
  return result
}

export function validateResolvedImport(rows: ImportPerson[], content: MasterContent) {
  validateResolvedContent(content)
  const classCodes = new Set(content.classes.map((item) => item.classCode))
  const personWithoutClass = rows.find((person) => person.active && person.classCode && !classCodes.has(person.classCode))
  if (personWithoutClass) {
    throw new Error(`${personWithoutClass.firstName} ${personWithoutClass.lastName} blijft gekoppeld aan ${personWithoutClass.classCode}, maar die klas wordt door deze keuzes niet opgenomen. Pas de gekozen acties aan.`)
  }
}

function validateResolvedContent(content: MasterContent) {
  const classCodes = new Set(content.classes.map((item) => item.classCode))
  const locationIds = new Set(content.locations.map((item) => item.id))
  const invalidClassReference = [...content.programmes, ...content.messages, ...content.povAssignments]
    .find((item) => item.classCodes !== 'all' && item.classCodes.some((code) => !classCodes.has(code)))
  if (invalidClassReference) throw new Error('Deze keuzes laten een programma, bericht of POV-opdracht verwijzen naar een verwijderde klas. Pas de gekozen acties aan.')
  const invalidLocationReference = content.programmes.find((item) => item.locationId && !locationIds.has(item.locationId))
  if (invalidLocationReference) throw new Error(`Programmaonderdeel “${invalidLocationReference.title}” verwijst door deze keuzes naar een verwijderde locatie.`)
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
