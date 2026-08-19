import { supabase } from './lib/supabase'

export type ClassContact = {
  id: string
  displayName: string
  email: string
  role: 'buddy' | 'poer'
}

const contactsCache = new Map<string, ClassContact[]>()

export async function fetchClassContacts(profileId: string, classCode: string, forceRefresh = false) {
  const cacheKey = `${profileId}:${classCode}`
  const cached = contactsCache.get(cacheKey)
  if (cached && !forceRefresh) return cached
  if (!supabase) return []

  const { data, error } = await supabase.rpc('get_my_class_contacts')
  if (error) {
    if (error.code === 'PGRST202' || error.message.includes('get_my_class_contacts')) {
      throw new Error('De persoonlijke contactlijst is nog niet in Supabase geactiveerd.')
    }
    throw new Error('De contactpersonen kunnen nu niet worden opgehaald.')
  }

  const contacts = (Array.isArray(data) ? data : []) as ClassContact[]
  contactsCache.set(cacheKey, contacts)
  return contacts
}
