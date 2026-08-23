import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { getDueScheduledMessages } from './scheduledMessages'
import type { ImportRole, MasterContent } from './import/parseWorkbook'

export type AppNotification = {
  id: string
  kind: 'welcome' | 'class_changed' | 'class_member_arrived' | 'class_member_left' | 'scheduled' | 'broadcast'
  title: string
  body: string
  createdAt: string
  readAt: string | null
  deliveryChannel?: 'in-app' | 'push' | 'both'
  actionTarget?: 'route' | 'programme' | 'notifications'
  sourceClassCode?: string | null
  sourceAudienceLabel?: string | null
  accentColor?: string | null
}

type NotificationRecord = {
  id: string
  kind: AppNotification['kind']
  title: string
  body: string
  created_at: string
  read_at: string | null
  delivery_channel?: AppNotification['deliveryChannel']
  action_target?: AppNotification['actionTarget']
  source_class_code?: string | null
  source_audience_label?: string | null
}

const MAX_NOTIFICATIONS = 20
const MIN_REFRESH_INTERVAL_MS = 60_000
const liveNotificationsEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true' && Boolean(supabase)
const realtimeEnabled = import.meta.env.VITE_REALTIME_ENABLED === 'true'
const SCHEDULED_READ_STORAGE_PREFIX = 'lm-you-scheduled-read:'
const BROWSER_NOTIFICATION_SEEN_STORAGE_PREFIX = 'lm-you-browser-notification-seen:'
const MAX_SEEN_BROWSER_NOTIFICATIONS = 100

const demoNotifications: AppNotification[] = [
  {
    id: 'demo-points-award',
    kind: 'scheduled',
    title: '🎉 +25 punten toegekend voor Australië!',
    body: 'Gefeliciteerd! De jury heeft +25 punten aan jullie klas (LM1A) toegekend voor de POV-foto opdracht. Bekijk de nieuwe stand in de Landenstrijd!',
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    readAt: null,
  },
  {
    id: 'demo-rank-alert',
    kind: 'class_changed',
    title: '⚠️ Stand gewijzigd in de Landenstrijd',
    body: 'Canada (LM1C) staat nu op #1. Jullie klas (LM1A) staat op de 2e plaats met 180 punten. Tijd voor de tegenaanval!',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    readAt: null,
  },
  {
    id: 'demo-reminder',
    kind: 'class_changed',
    title: 'Nog 20 minuten!',
    body: 'Rond jullie lunch af en ga richting Sportcentrum De Pijp.',
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
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
    deliveryChannel: record.delivery_channel,
    actionTarget: record.action_target,
    sourceClassCode: record.source_class_code,
    sourceAudienceLabel: record.source_audience_label,
    accentColor: classAccent(record.source_class_code),
  }
}

async function showBrowserNotification(notification: AppNotification) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const options: NotificationOptions = {
    body: notification.body,
    tag: notification.id,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
    data: { actionTarget: notification.actionTarget ?? 'notifications' },
  }
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(notification.title, options)
      return
    } catch {
      // Gebruik hieronder de gewone browsermelding als serviceworker fallback.
    }
  }
  new Notification(notification.title, options)
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

function getBrowserNotificationSeenIds(profileKey: string): Set<string> | null {
  try {
    const stored = window.localStorage.getItem(`${BROWSER_NOTIFICATION_SEEN_STORAGE_PREFIX}${profileKey}`)
    if (stored === null) return null
    const parsed = JSON.parse(stored)
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return null
  }
}

function saveBrowserNotificationSeenIds(profileKey: string, ids: Set<string>) {
  window.localStorage.setItem(
    `${BROWSER_NOTIFICATION_SEEN_STORAGE_PREFIX}${profileKey}`,
    JSON.stringify([...ids].slice(-MAX_SEEN_BROWSER_NOTIFICATIONS)),
  )
}

const CLASS_ACCENTS: Record<string, string> = {
  LM1A: '#d7263d', LM1B: '#f28c28', LM1C: '#e0b400', LM1D: '#2e9d58',
  LM1E: '#159a9c', LM1F: '#2f6fd0', LM1G: '#6554c0', LM1H: '#a446b8',
}

function classAccent(classCode?: string | null, classes?: MasterContent['classes']) {
  if (!classCode) return null
  return classes?.find((item) => item.classCode === classCode)?.accentColor ?? CLASS_ACCENTS[classCode] ?? '#e3004f'
}

function mapScheduledNotifications(classCode: string, profileKey: string, profileRole: ImportRole, masterMessages?: MasterContent['messages'], masterClasses?: MasterContent['classes']): AppNotification[] {
  const readIds = getScheduledReadIds(profileKey)
  const messages = masterMessages?.length
    ? masterMessages.filter((message) => message.active
      && (message.channel === 'in-app' || message.channel === 'both')
      && new Date(message.scheduledAt).getTime() <= Date.now()
      && (!message.expiresAt || new Date(message.expiresAt).getTime() > Date.now())
      && (message.classCodes === 'all' || message.classCodes.includes(classCode))
      && message.roles.includes(profileRole)
      && (!message.recipientProfileIds?.length
        || profileRole === 'student'
        || message.recipientProfileIds.includes(profileKey)))
    : getDueScheduledMessages(classCode)
  return messages.map((message) => ({
    id: `scheduled:${message.id}`,
    kind: 'scheduled',
    title: message.title,
    body: message.body,
    createdAt: message.scheduledAt,
    readAt: readIds.has(message.id) ? message.scheduledAt : null,
    sourceClassCode: message.classCodes === 'all' ? null : classCode,
    sourceAudienceLabel: message.classCodes === 'all' ? 'Ontvangen als deelnemer' : `Ontvangen als lid van ${classCode}`,
    accentColor: message.classCodes === 'all' ? null : classAccent(classCode, masterClasses),
  }))
}

export function useNotifications(profileId: string | null, classCode: string, profileRole: ImportRole, masterMessages?: MasterContent['messages'], masterClasses?: MasterContent['classes']) {
  const profileKey = profileId ?? `demo:${classCode}`
  const [notifications, setNotifications] = useState<AppNotification[]>(
    liveNotificationsEnabled ? [] : [...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages, masterClasses), ...demoNotifications],
  )
  const [loading, setLoading] = useState(liveNotificationsEnabled)
  const [error, setError] = useState('')
  const lastFetchedAt = useRef(0)
  const requestInFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async (force = false) => {
    if (!liveNotificationsEnabled || !supabase || !profileId) {
      setNotifications([...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages, masterClasses), ...demoNotifications])
      setLoading(false)
      return
    }

    if (!force && Date.now() - lastFetchedAt.current < MIN_REFRESH_INTERVAL_MS) return
    if (requestInFlight.current) return requestInFlight.current

    const request = (async () => {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('id, kind, title, body, created_at, read_at, delivery_channel, action_target, source_class_code, source_audience_label')
        .order('created_at', { ascending: false })
        .limit(MAX_NOTIFICATIONS)

      if (fetchError) {
        setError('Meldingen konden niet worden opgehaald. Probeer het later opnieuw.')
      } else {
        const personalNotifications = ((data ?? []) as NotificationRecord[]).map(mapNotification)
        const storedSeenIds = getBrowserNotificationSeenIds(profileKey)
        const seenIds = storedSeenIds ?? new Set<string>()
        const newPushNotifications = storedSeenIds === null
          ? []
          : personalNotifications.filter((notification) => (
              (notification.deliveryChannel === 'push' || notification.deliveryChannel === 'both')
              && !seenIds.has(notification.id)
            ))
        personalNotifications.slice().reverse().forEach((notification) => seenIds.add(notification.id))
        saveBrowserNotificationSeenIds(profileKey, seenIds)
        setNotifications([
          ...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages, masterClasses),
          ...personalNotifications,
        ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()))
        setError('')
        lastFetchedAt.current = Date.now()
        newPushNotifications.slice().reverse().forEach((notification) => {
          void showBrowserNotification(notification)
        })
      }
      setLoading(false)
    })()

    requestInFlight.current = request
    await request
    requestInFlight.current = null
  }, [classCode, masterClasses, masterMessages, profileId, profileKey, profileRole])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    const mergeReleasedMessages = () => {
      setNotifications((current) => [
        ...mapScheduledNotifications(classCode, profileKey, profileRole, masterMessages, masterClasses),
        ...current.filter((notification) => notification.kind !== 'scheduled'),
      ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()))
    }

    mergeReleasedMessages()
    const timer = window.setInterval(mergeReleasedMessages, 60_000)
    return () => window.clearInterval(timer)
  }, [classCode, masterClasses, masterMessages, profileKey, profileRole])

  useEffect(() => {
    if (!liveNotificationsEnabled || !supabase || !profileId) return

    const client = supabase
    const channel = realtimeEnabled ? client
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
          const seenIds = getBrowserNotificationSeenIds(profileKey) ?? new Set<string>()
          if ((next.deliveryChannel === 'push' || next.deliveryChannel === 'both') && !seenIds.has(next.id)) {
            void showBrowserNotification(next)
          }
          seenIds.add(next.id)
          saveBrowserNotificationSeenIds(profileKey, seenIds)
        },
      )
      .subscribe() : null

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, MIN_REFRESH_INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(timer)
      if (channel) void client.removeChannel(channel)
    }
  }, [profileId, profileKey, refresh])

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
