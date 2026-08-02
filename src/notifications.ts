import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

export type AppNotification = {
  id: string
  kind: 'welcome' | 'class_changed' | 'class_member_arrived' | 'class_member_left'
  title: string
  body: string
  createdAt: string
  readAt: string | null
}

type NotificationRecord = {
  id: string
  kind: AppNotification['kind']
  title: string
  body: string
  created_at: string
  read_at: string | null
}

const MAX_NOTIFICATIONS = 20
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const liveNotificationsEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true' && Boolean(supabase)

const demoNotifications: AppNotification[] = [
  {
    id: 'demo-reminder',
    kind: 'class_changed',
    title: 'Nog 20 minuten!',
    body: 'Rond jullie lunch af en ga richting Sportcentrum De Pijp.',
    createdAt: new Date().toISOString(),
    readAt: null,
  },
  {
    id: 'demo-pov',
    kind: 'class_member_arrived',
    title: 'Reminder POV',
    body: 'Vergeet de categorieën voor jullie foto’s niet.',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    readAt: null,
  },
]

function mapNotification(record: NotificationRecord): AppNotification {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    body: record.body,
    createdAt: record.created_at,
    readAt: record.read_at,
  }
}

export function useNotifications(profileId: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>(
    liveNotificationsEnabled ? [] : demoNotifications,
  )
  const [loading, setLoading] = useState(liveNotificationsEnabled)
  const [error, setError] = useState('')
  const lastFetchedAt = useRef(0)
  const requestInFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async (force = false) => {
    if (!liveNotificationsEnabled || !supabase || !profileId) {
      setNotifications(demoNotifications)
      setLoading(false)
      return
    }

    if (!force && Date.now() - lastFetchedAt.current < MIN_REFRESH_INTERVAL_MS) return
    if (requestInFlight.current) return requestInFlight.current

    const request = (async () => {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('id, kind, title, body, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(MAX_NOTIFICATIONS)

      if (fetchError) {
        setError('Meldingen konden niet worden opgehaald. Probeer het later opnieuw.')
      } else {
        setNotifications(((data ?? []) as NotificationRecord[]).map(mapNotification))
        setError('')
        lastFetchedAt.current = Date.now()
      }
      setLoading(false)
    })()

    requestInFlight.current = request
    await request
    requestInFlight.current = null
  }, [profileId])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    if (!liveNotificationsEnabled || !supabase || !profileId) return

    const client = supabase
    const channel = client
      .channel(`personal-notifications:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_profile_id=eq.${profileId}`,
        },
        (payload) => {
          const next = mapNotification(payload.new as NotificationRecord)
          setNotifications((current) => [
            next,
            ...current.filter((notification) => notification.id !== next.id),
          ].slice(0, MAX_NOTIFICATIONS))
        },
      )
      .subscribe()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      void client.removeChannel(channel)
    }
  }, [profileId, refresh])

  const markRead = useCallback(async (notificationId: string) => {
    if (!liveNotificationsEnabled || !supabase) {
      setNotifications((current) => current.map((notification) => (
        notification.id === notificationId
          ? { ...notification, readAt: new Date().toISOString() }
          : notification
      )))
      return
    }

    const readAt = new Date().toISOString()
    setNotifications((current) => current.map((notification) => (
      notification.id === notificationId ? { ...notification, readAt } : notification
    )))

    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', notificationId)

    if (updateError) {
      setError('De melding kon niet als gelezen worden gemarkeerd.')
      void refresh(true)
    }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((notification) => !notification.readAt)
      .map((notification) => notification.id)
    if (unreadIds.length === 0) return

    const readAt = new Date().toISOString()
    setNotifications((current) => current.map((notification) => (
      notification.readAt ? notification : { ...notification, readAt }
    )))

    if (!liveNotificationsEnabled || !supabase) return
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .in('id', unreadIds)

    if (updateError) {
      setError('Niet alle meldingen konden als gelezen worden gemarkeerd.')
      void refresh(true)
    }
  }, [notifications, refresh])

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications],
  )

  return {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  }
}
