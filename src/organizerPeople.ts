import { supabase } from './lib/supabase'
import type { ImportPerson } from './import/parseWorkbook'

export type OrganizerPerson = ImportPerson & {
  profileId: string
}

function requireClient() {
  if (!supabase) throw new Error('De beveiligde databaseverbinding is nog niet geconfigureerd.')
  return supabase
}

function friendlyOrganizerError(error: { code?: string; message?: string }, fallback: string) {
  if (error.code === '42501') return 'Alleen een actieve organisator mag personen beheren.'
  if (error.code === '23505') return 'Dit e-mailadres of studentnummer is al aan een ander profiel gekoppeld.'
  if (error.code === '22023') return error.message || 'De ingevulde persoonsgegevens zijn niet geldig.'
  if (error.code === 'PGRST202') return 'Het beveiligde personenbeheer is nog niet in Supabase geactiveerd.'
  return fallback
}

export async function fetchOrganizerPeople(): Promise<OrganizerPerson[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('get_organizer_people')
  if (error) throw new Error(friendlyOrganizerError(error, 'De personenlijst kon niet worden opgehaald.'))
  return (Array.isArray(data) ? data : []) as OrganizerPerson[]
}

export async function saveOrganizerPerson(person: ImportPerson, profileId: string | null): Promise<OrganizerPerson> {
  const client = requireClient()
  const { data, error } = await client.rpc('save_organizer_person', {
    target_profile_id: profileId,
    person_student_number: person.studentNumber,
    person_first_name: person.firstName,
    person_name_prefix: person.namePrefix,
    person_last_name: person.lastName,
    person_email: person.email,
    person_role: person.role,
    person_class_code: person.classCode,
    person_active: person.active,
  })
  if (error) throw new Error(friendlyOrganizerError(error, 'De persoon kon niet worden opgeslagen.'))
  return data as OrganizerPerson
}

export async function notifyOrganizerPersonChange(input: {
  profileId: string
  title: string
  body: string
  deliveryChannel: 'in-app' | 'push' | 'both'
}): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc('notify_organizer_person_change', {
    target_profile_id: input.profileId,
    message_title: input.title,
    message_body: input.body,
    delivery_channel: input.deliveryChannel,
  })
  if (error) throw new Error(friendlyOrganizerError(error, 'De wijziging is opgeslagen, maar de notificatie kon niet worden verstuurd.'))
}

export async function deactivateOrganizerPerson(profileId: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc('deactivate_organizer_person', { target_profile_id: profileId })
  if (error) throw new Error(friendlyOrganizerError(error, 'De persoon kon niet uit de app worden verwijderd.'))
}
