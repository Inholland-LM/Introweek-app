import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { programmeDays as fallbackProgrammeDays, routeDays as fallbackRouteDays, type ProgrammeDay, type RouteDay } from './data'
import type { MasterContent } from './import/parseWorkbook'

type CachedContent = { version: number; content: MasterContent }

// v2 voorkomt dat een oude inhoudssnapshot met toevallig hetzelfde
// databaseversienummer als de huidige snapshot als actueel wordt gezien.
// Dit veroorzaakt per apparaat eenmalig een volledige inhoudsdownload;
// daarna blijven de egresszuinige versienummercontroles actief.
const CACHE_KEY = 'lm-you-master-content:v3'
const MIN_VERSION_CHECK_MS = 5 * 60 * 1000
const realtimeEnabled = import.meta.env.VITE_REALTIME_ENABLED === 'true'

function readCache(): CachedContent | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null')
    return parsed && typeof parsed.version === 'number' && parsed.content ? parsed : null
  } catch { return null }
}

function saveCache(value: CachedContent) {
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(value))
}

export function saveMasterContent(nextContent: MasterContent) {
  const next = { version: Date.now(), content: nextContent }
  saveCache(next)
  return next
}

async function broadcastContentVersion(version: number) {
  if (!supabase || !realtimeEnabled) return
  const channel = supabase.channel('app-content-updates')
  await new Promise<void>((resolve) => {
    const fallback = window.setTimeout(resolve, 1_500)
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      window.clearTimeout(fallback)
      void channel.send({ type: 'broadcast', event: 'content-version', payload: { version } })
        .finally(resolve)
    })
  })
  await supabase.removeChannel(channel)
}

export async function updateMasterContent(nextContent: MasterContent, expectedVersion: number) {
  if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true') {
    return saveMasterContent(nextContent)
  }

  const { data, error } = await supabase.rpc('update_app_content', {
    expected_content_version: expectedVersion,
    updated_content: nextContent,
  })
  if (error) throw error

  const version = Number(data?.version)
  if (!Number.isFinite(version)) throw new Error('Supabase gaf geen geldig inhoudsversienummer terug.')
  const next = { version, content: nextContent }
  saveCache(next)
  await broadcastContentVersion(version)
  return next
}

export function useMasterContent() {
  const [cached, setCached] = useState<CachedContent | null>(readCache)
  const [lastCheckedAt, setLastCheckedAt] = useState(0)

  const refresh = useCallback(async (force = false) => {
    // 1. Always sync from local cache first
    const local = readCache()
    if (local) {
      setCached(local)
    }

    // 2. Fetch from Supabase if auth enabled
    if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true' || !realtimeEnabled) return
    if (!force && Date.now() - lastCheckedAt < MIN_VERSION_CHECK_MS) return
    const { data: version, error: versionError } = await supabase.rpc('get_app_content_version')
    setLastCheckedAt(Date.now())
    if (versionError || Number(version ?? 0) === Number(cached?.version ?? -1)) return
    const { data, error } = await supabase.rpc('get_app_content')
    if (error || !data?.content) return
    const next = { version: Number(data.version), content: data.content as MasterContent }
    saveCache(next)
    setCached(next)
  }, [cached?.version, lastCheckedAt])

  useEffect(() => { void refresh(true) }, []) // eenmaal na inloggen
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, MIN_VERSION_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    if (!supabase || import.meta.env.VITE_AUTH_ENABLED !== 'true') return
    const client = supabase
    const channel = client
      .channel('app-content-updates')
      .on('broadcast', { event: 'content-version' }, () => { void refresh(true) })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [refresh])

  return { content: cached?.content ?? null, version: cached?.version ?? 0, refresh }
}

const dayMeta: Record<string, Pick<ProgrammeDay, 'id' | 'shortLabel' | 'date' | 'title' | 'summary'>> = {
  '2026-08-25': { id: 'dinsdag', shortLabel: 'Di 25', date: '25 augustus', title: 'Welkom & kennismaken', summary: 'Jouw actuele programma voor de eerste introductiedag.' },
  '2026-08-26': { id: 'woensdag', shortLabel: 'Wo 26', date: '26 augustus', title: 'Experiences door Amsterdam', summary: 'Jouw actuele programma voor de tweede introductiedag.' },
  '2026-08-27': { id: 'donderdag', shortLabel: 'Do 27', date: '27 augustus', title: 'City Game & finale', summary: 'Jouw actuele programma voor de afsluitende introductiedag.' },
}

export function buildProgrammeDays(content: MasterContent | null, classCode: string): ProgrammeDay[] {
  if (!content?.programmes?.length) return fallbackProgrammeDays
  const locations = new Map((content.locations ?? []).filter((item) => item && item.active !== false).map((item) => [item.id ?? item.name, item]))
  const locationsByName = new Map((content.locations ?? []).filter((item) => item && item.active !== false).map((item) => [item.name, item]))

  return Object.entries(dayMeta).map(([date, meta]) => ({
    ...meta,
    items: (content.programmes ?? [])
      .filter((item) => {
        if (!item || item.active === false) return false
        const itemDate = item.date ?? '2026-08-25'
        if (itemDate !== date) return false
        const codes = item.classCodes ?? 'all'
        return codes === 'all' || (Array.isArray(codes) && codes.includes(classCode))
      })
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || (left.startTime ?? '').localeCompare(right.startTime ?? ''))
      .map((item) => {
        const locKey = item.locationId ?? ''
        const location = locations.get(locKey) ?? locationsByName.get(locKey)
        const rawLoc = location?.name ?? item.locationId ?? 'Inholland Amsterdam'
        const finalLoc = (!rawLoc || rawLoc === 'Inholland') ? 'Inholland Amsterdam' : rawLoc
        return {
          time: item.startTime ?? '12:00',
          title: item.title ?? 'Activiteit',
          category: item.category ?? 'Programma',
          location: finalLoc,
          routeUrl: location?.routeUrl ?? 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4',
        }
      }),
  }))
}

export function buildRouteDays(content: MasterContent | null, classCode: string): RouteDay[] {
  if (!content?.programmes?.length) return fallbackRouteDays
  const programmes = buildProgrammeDays(content, classCode)
  const locations = new Map((content.locations ?? []).filter((item) => item && item.active !== false).map((item) => [item.name ?? item.id, item]))
  return programmes.map((day) => ({
    id: day.id,
    shortLabel: day.shortLabel,
    label: day.title,
    stops: (day.items ?? []).flatMap((item) => {
      if (!item) return []
      const location = item.location ? locations.get(item.location) : null
      if (!location || location.latitude === null || location.longitude === null || !location.routeUrl) return []
      return [{ number: 0, time: item.time, title: location.name, address: `${location.address}, ${location.city}`, routeUrl: location.routeUrl, latitude: location.latitude, longitude: location.longitude }]
    }).filter((stop, index, all) => stop && all.findIndex((item) => item && item.title === stop.title) === index)
      .map((stop, index) => ({ ...stop, number: index + 1 })),
  }))
}

export function createInitialMasterContent(): MasterContent {
  const classAppUrl = 'https://chat.whatsapp.com/KAAGsGCVnOD6fC1Is140pw'
  return {
    classes: [
      { classCode: 'LM1A', country: 'Nederland', flag: '🇳🇱', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1B', country: 'Duitsland', flag: '🇩🇪', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1C', country: 'Frankrijk', flag: '🇫🇷', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1D', country: 'Spanje', flag: '🇪🇸', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1E', country: 'Italië', flag: '🇮🇹', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1F', country: 'Zweden', flag: '🇸🇪', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1G', country: 'Noorwegen', flag: '🇳🇴', povUrl: null, classAppUrl, active: true },
      { classCode: 'LM1H', country: 'Denemarken', flag: '🇩🇰', povUrl: null, classAppUrl, active: true },
    ],
    locations: [
      { id: 'loc-1', name: 'Inholland Amsterdam', address: 'Pina Bauschplein 4', postalCode: '1095 PN', city: 'Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4', latitude: 52.3702, longitude: 4.9530, active: true },
      { id: 'loc-2', name: 'De Duif', address: 'Prinsengracht 756', postalCode: '1017 LD', city: 'Amsterdam', routeUrl: 'https://maps.app.goo.gl/TzDtQjuwy45XLf9S7', latitude: 52.3621, longitude: 4.8974, active: true },
      { id: 'loc-3', name: 'Sportcentrum De Pijp', address: 'Lizzy Ansinghstraat 88', postalCode: '1072 RD', city: 'Amsterdam', routeUrl: 'https://maps.app.goo.gl/X5UauhuGxNfmSAwq6', latitude: 52.3524, longitude: 4.8942, active: true },
      { id: 'loc-4', name: 'NDSM-werf', address: 'NDSM-Plein 1', postalCode: '1033 WC', city: 'Amsterdam', routeUrl: 'https://maps.app.goo.gl/NWYgPZzJN3uzpzHV6', latitude: 52.4005, longitude: 4.8925, active: true },
      { id: 'loc-5', name: 'Baggerbeest', address: 'Eef Kamerbeekstraat 1006', postalCode: '1095 MJ', city: 'Amsterdam', routeUrl: 'https://maps.google.com/?q=Baggerbeest+Amsterdam', latitude: 52.3708, longitude: 4.9602, active: true },
    ],
    programmes: [
      { id: 'prog-1', date: '2026-08-25', startTime: '13:00', endTime: '14:30', title: 'Ontvangst eerstejaars', category: 'Welkom', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Ontvangst, klasindeling en begeleiding naar de lokalen.', order: 1, active: true },
      { id: 'prog-2', date: '2026-08-25', startTime: '14:30', endTime: '15:00', title: 'Ontdek de Sluisbuurt', category: 'Foto-opdracht', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Ontdek de school en voer de foto-opdracht uit.', order: 2, active: true },
      { id: 'prog-3', date: '2026-08-25', startTime: '15:00', endTime: '16:00', title: 'Openingsceremonie', category: 'Gezamenlijk', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Gezamenlijke opening op het balkon van de tweede verdieping.', order: 3, active: true },
      { id: 'prog-4', date: '2026-08-25', startTime: '16:00', endTime: '16:15', title: 'Vlaggenparade', category: 'Landenstrijd', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Vertrek per klas richting Baggerbeest.', order: 4, active: true },
      { id: 'prog-5', date: '2026-08-25', startTime: '16:15', endTime: '19:00', title: 'Goodiebags, spellen & borrel', category: 'Afsluiting', locationId: 'Baggerbeest', classCodes: 'all', description: 'Afsluiting bij Baggerbeest.', order: 5, active: true },
      { id: 'prog-6', date: '2026-08-26', startTime: '11:45', endTime: '13:30', title: 'Het Amsterdams Geluid', category: 'Experience', locationId: 'De Duif', classCodes: 'all', description: 'Experience in De Duif.', order: 1, active: true },
      { id: 'prog-7', date: '2026-08-26', startTime: '13:30', endTime: '14:30', title: 'Lunch & verplaatsing', category: 'Eigen tijd', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Zelfstandige lunch.', order: 2, active: true },
      { id: 'prog-8', date: '2026-08-26', startTime: '14:30', endTime: '16:00', title: 'Sports Experiences', category: 'Experience', locationId: 'Sportcentrum De Pijp', classCodes: 'all', description: 'Sports experiences.', order: 3, active: true },
      { id: 'prog-9', date: '2026-08-26', startTime: '16:00', endTime: '18:00', title: 'Einde programma & naborrel', category: 'Vrijblijvend', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Naborrel bij Inholland Amsterdam.', order: 4, active: true },
      { id: 'prog-10', date: '2026-08-27', startTime: '10:45', endTime: '12:30', title: 'Cultural Experiences', category: 'City Game', locationId: 'NDSM-werf', classCodes: 'all', description: 'City game door Amsterdam.', order: 1, active: true },
      { id: 'prog-11', date: '2026-08-27', startTime: '15:00', endTime: '18:00', title: 'BLEND-festival', category: 'Festival', locationId: 'Inholland Amsterdam', classCodes: 'all', description: 'Eindfestival en prijsuitreiking.', order: 2, active: true },
    ],
    messages: [],
    povAssignments: [
      { id: 'pov-01', title: 'Leukste teamfoto', description: 'Leg jullie team op zijn allerleukst vast.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-02', title: 'Sportiefste foto tijdens SX', description: 'Maak de sportiefste foto tijdens SX.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-03', title: 'Creatiefste foto tijdens HAG', description: 'Verras de jury met jullie creatiefste foto tijdens HAG.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-04', title: 'Origineelste foto op de NDSM-werf', description: 'Maak op de NDSM-werf een foto die niemand anders bedenkt.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-05', title: 'Grappigste foto bij ENTR', description: 'Leg het grappigste moment bij ENTR vast.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-06', title: 'Opvallendste foto op de Nieuwmarkt', description: 'Val op met jullie foto op de Nieuwmarkt.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-07', title: 'Gezelligste foto tijdens een borrel', description: 'Vang de gezelligste sfeer van een borrel.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-08', title: 'Grappigste foto', description: 'Laat de jury lachen met jullie grappigste foto.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
      { id: 'pov-09', title: 'Uitblinker', description: 'Zet jullie uitblinker in de spotlight.', classCodes: 'all', deadlineAt: '2026-08-27T16:00:00+02:00', maxUploads: 5, active: true },
    ],
    practical: [],
    discounts: [
      { id: 'discount-beautiful-mess', name: 'A Beautiful Mess', description: '10% korting op het pakket met huisgemaakte dips, versgebakken flatbread, een kleine sweet treat en huisgemaakte limonade.', address: 'Oosterdokskade 227, 1011 DL Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=A+Beautiful+Mess+Oosterdokskade+227+Amsterdam', terms: 'Op vertoon van de introweekvoucher.', validFrom: '2026-08-27', validUntil: '2026-08-27', active: true },
      { id: 'discount-we-are-edn', name: 'WE ARE EDN Restaurant', description: '20% korting op de totale bon.', address: 'Oosterdokskade 4, Ground Floor, 1011 DK Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=WE+ARE+EDN+Restaurant+Oosterdokskade+4+Amsterdam', terms: 'Op vertoon van de voucher.', validFrom: '2026-08-27', validUntil: '2026-08-27', active: true },
      { id: 'discount-baanderij', name: 'De Baanderij', description: 'Een koffie voor € 1.', address: 'NDSM-Kade 5, 1033 PG Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=De+Baanderij+NDSM-Kade+5+Amsterdam', terms: 'Op vertoon van de introweekvoucher.', validFrom: '2026-08-27', validUntil: '2026-08-27', active: true },
      { id: 'discount-ijver', name: 'IJver Amsterdam', description: '20% korting op de totale bon.', address: 'Scheepsbouwkade 72, 1033 WM Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=IJver+Amsterdam+Scheepsbouwkade+72', terms: 'Op vertoon van de introweekvoucher.', validFrom: '2026-08-27', validUntil: '2026-08-27', active: true },
      { id: 'discount-waag', name: 'De Waag', description: '10% korting op eten en drinken.', address: 'Nieuwmarkt 4, 1012 CR Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=De+Waag+Nieuwmarkt+4+Amsterdam', terms: 'Op vertoon van de introweekvoucher.', validFrom: '2026-08-27', validUntil: '2026-08-27', active: true },
    ],
    settings: {
      app_name: 'LM = YOU',
      toon_kortingen: 'ja',
      toon_pov: 'ja',
      instagram_url: 'https://www.instagram.com/introweeklm2026?igsh=MmdpcTl1b3FjOGRz&igsi=MmdpcTl1b3FjOGRz',
    },
  }
}
