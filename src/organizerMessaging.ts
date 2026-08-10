import { supabase } from './lib/supabase'

export type OrganizerRecipient = {
  id: string
  displayName: string
  email: string
  role: 'buddy' | 'poer'
  classCode: string | null
}

export type OrganizerDeliveryChannel = 'in-app' | 'push' | 'both'

export async function fetchOrganizerRecipients(): Promise<OrganizerRecipient[]> {
  if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true') return []
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  const { data, error } = await supabase.rpc('get_organizer_message_recipients')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as OrganizerRecipient[]
}

export async function sendOrganizerNotification(input: {
  title: string
  body: string
  classCodes: string[]
  recipientProfileIds: string[]
  deliveryChannel: OrganizerDeliveryChannel
  actionTarget: 'route' | 'programme' | 'notifications'
}) {
  if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true') {
    return { recipientCount: input.classCodes.length + input.recipientProfileIds.length }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { recipientCount: input.classCodes.length + input.recipientProfileIds.length }

  const { data, error } = await supabase.rpc('send_organizer_notification', {
    message_title: input.title,
    message_body: input.body,
    target_class_codes: input.classCodes,
    target_profile_ids: input.recipientProfileIds,
    delivery_channel: input.deliveryChannel,
    action_target: input.actionTarget,
  })
  if (error) throw error
  return { recipientCount: Number(data?.recipientCount ?? 0) }
}
