import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { getDueScheduledMessages } from './scheduledMessages'
import type { ImportRole, MasterContent } from './import/parseWorkbook'

export type AppNotification = {
  id: string
  kind: 'welcome' | 'class_changed' | 'class_member_arrived' | 'class_member_left' | 'scheduled'
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
const SCHEDULED_READ_STORAGE_PREFIX = 'lm-you-scheduled-read:'

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

function getScheduledReadIds(profileKey: string) {
  try {
    const stored = window.localStorage.getItem(`${SCHEDULED_READ_STORAGE_PREFIX}${profileKey}`)
    const parsed = stored ? JSON.parse(stored) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function saveScheduledReadIds(profileKey: string, ids: Set<string>) {
  window.localStorage.setItem(`${SCHEDULED_READ_STORAGE_PREFIX}${profileKey}`, JSON.stringify([...ids]))
}

function mapScheduledNotifications(classCode: string, profileKey: string, profileRole: ImportRole, masterMessages?: MasterContent['messages']): AppNotification[] {
  const readIds = getScheduledReadIds(profileKey)
  const messages = masterMessages?.length
    ? masterMessages.filter((message) => message.active
      && message.channel === 'in-app'
      && new Date(message.scheduledAt).getTime() <= Date.now()
      && (message.classCodes === 'all' || message.classCodes.includes(classCode))
      && message.roles.includes(profileRole))
    : getDueScheduledMessages(classCode)
  return messages.map((message) => ({
    id: `scheduled:${message.id}`,
    kind: 'scheduled',
    title: message.title,
    body: message.body,
    createdAt: message.scheduledAt,
    readAt: readIds.has(message.id) ? message.scheduledAt : null,
  }))
}

export function useNotifications(profileId: string | null, classCode: string, profileRole: ImportRole, masterMessages?: MasterContent['messages']) {
  const profileKey = profileId ?? `demo:${classCode}`
  const [notifications, setNotifications] = useState<AppNotification[]>(
    liveNotificationsEnabled ? [] : [...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages), ...demoNotifications],
  )
  const [loading, setLoading] = useState(liveNotificationsEnabled)
  const [error, setError] = useState('')
  const lastFetchedAt = useRef(0)
  const requestInFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async (force = false) => {
    if (!liveNotificationsEnabled || !supabase || !profileId) {
      setNotifications([...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages), ...demoNotifications])
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
        const personalNotifications = ((data ?? []) as NotificationRecord[]).map(mapNotification)
        setNotifications([
          ...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages),
          ...personalNotifications,
        ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()))
        setError('')
        lastFetchedAt.current = Date.now()
      }
      setLoading(false)
    })()

    requestInFlight.current = request
    await request
    requestInFlight.current = null
  }, [classCode, masterMessages, profileId, profileKey, profileRole])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    const mergeReleasedMessages = () => {
      setNotifications((current) => [
        ...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages),
        ...current.filter((notification) => notification.kind !== 'scheduled'),
      ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()))
    }

    mergeReleasedMessages()
    const timer = window.setInterval(mergeReleasedMessages, 60_000)
    return () => window.clearInterval(timer)
  }, [classCode, masterMessages, profileKey, profileRole])

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
    setError('')
    if (notificationId.startsWith('scheduled:')) {
      const messageId = notificationId.slice('scheduled:'.length)
      const readIds = getScheduledReadIds(profileKey)
      readIds.add(messageId)
      saveScheduledReadIds(profileKey, readIds)
      setNotifications((current) => current.map((notification) => (
        notification.id === notificationId
          ? { ...notification, readAt: new Date().toISOString() }
          : notification
      )))
      return
    }

    if (!liveNotificationsEnabled || !supabase || notificationId.startsWith('demo-')) {
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

    try {
      await supabase
        .from('notifications')
        .update({ read_at: readAt })
        .eq('id', notificationId)
    } catch {
      // Keep optimistic read state locally
    }
  }, [profileKey])

  const markAllRead = useCallback(async () => {
    setError('')
    const unreadIds = notifications
      .filter((notification) => !notification.readAt)
      .map((notification) => notification.id)
    if (unreadIds.length === 0) return

    const readAt = new Date().toISOString()
    setNotifications((current) => current.map((notification) => (
      notification.readAt ? notification : { ...notification, readAt }
    )))

    const scheduledMessageIds = unreadIds
      .filter((id) => id.startsWith('scheduled:'))
      .map((id) => id.slice('scheduled:'.length))
    if (scheduledMessageIds.length > 0) {
      const readIds = getScheduledReadIds(profileKey)
      scheduledMessageIds.forEach((id) => readIds.add(id))
      saveScheduledReadIds(profileKey, readIds)
    }

    if (!liveNotificationsEnabled || !supabase) return
    const databaseIds = unreadIds.filter((id) => !id.startsWith('scheduled:') && !id.startsWith('demo-'))
    if (databaseIds.length === 0) return

    try {
      await supabase
        .from('notifications')
        .update({ read_at: readAt })
        .in('id', databaseIds)
    } catch {
      // Keep optimistic read state
    }
  }, [notifications, profileKey])

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications],
  )

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      if (unreadCount > 0) {
        void (navigator as any).setAppBadge(unreadCount).catch(() => {})
      } else if ('clearAppBadge' in navigator) {
        void (navigator as any).clearAppBadge().catch(() => {})
      }
    }
  }, [unreadCount])

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
