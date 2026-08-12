import { useEffect, useRef, useState, type TouchEvent } from 'react'
import {
  Bell,
  BadgePercent,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  Ellipsis,
  LocateFixed,
  LogOut,
  Map,
  MapPin,
  Mail,
  Navigation,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Trophy,
  X,
} from 'lucide-react'
import { defaultScoreHistories, getDefaultIntroDayId, standings, type ProgrammeDay, type RouteDay, type Standing, type TeamScoreHistory } from './data'
import { buildProgrammeDays, buildRouteDays, useMasterContent } from './content'
import { ImportPreviewPanel } from './import/ImportPreviewPanel'
import { type AppNotification, useNotifications } from './notifications'
import { useAppProfile, useProfileLogout } from './profile'
import { fetchClassContacts, type ClassContact } from './contacts'
import type { MasterContent } from './import/parseWorkbook'
import { PovPanel } from './PovPanel'
import { OrganizerDashboard } from './OrganizerDashboard'

export type WeatherInfo = {
  temperature: number
  weatherCode: number
  description: string
  icon: string
  advice: string
}

const weatherCacheKey = 'lmyou-amsterdam-weather-v2'
const weatherCacheLifetimeMs = 30 * 60 * 1000

function describeWeather(weatherCode: number, temperature: number, isDay: boolean): Omit<WeatherInfo, 'temperature' | 'weatherCode'> {
  if (weatherCode === 0) return {
    icon: isDay ? '☀️' : '🌙',
    description: 'Helder',
    advice: temperature >= 23
      ? 'Zonnig en warm. Neem zonnebrand en een gevulde waterfles mee.'
      : 'Helder weer voor de buitenactiviteiten.',
  }
  if (weatherCode >= 1 && weatherCode <= 3) return {
    icon: isDay ? '⛅' : '☁️',
    description: weatherCode === 3 ? 'Bewolkt' : 'Licht bewolkt',
    advice: 'Prima weer om door Amsterdam te reizen. Neem voor de zekerheid een lichte jas mee.',
  }
  if (weatherCode === 45 || weatherCode === 48) return {
    icon: '🌫️',
    description: 'Mistig',
    advice: 'Het zicht kan beperkt zijn. Neem extra tijd en let goed op in het verkeer.',
  }
  if (weatherCode >= 51 && weatherCode <= 57) return {
    icon: '🌦️',
    description: weatherCode >= 56 ? 'IJzel of motregen' : 'Motregen',
    advice: 'Er valt motregen. Neem een regenjas of paraplu mee.',
  }
  if (weatherCode >= 61 && weatherCode <= 67) return {
    icon: '🌧️',
    description: weatherCode >= 66 ? 'IJzel of regen' : 'Regen',
    advice: 'Neem een regenjas of paraplu mee en houd rekening met extra reistijd.',
  }
  if (weatherCode >= 71 && weatherCode <= 77) return {
    icon: '🌨️',
    description: 'Sneeuw',
    advice: 'Er wordt sneeuw gemeld. Kleed je warm aan en houd rekening met gladheid.',
  }
  if (weatherCode >= 80 && weatherCode <= 82) return {
    icon: '🌧️',
    description: 'Regenbuien',
    advice: 'Er worden regenbuien gemeld. Neem regenkleding mee en zoek zo nodig een overdekte plek.',
  }
  if (weatherCode === 85 || weatherCode === 86) return {
    icon: '🌨️',
    description: 'Sneeuwbuien',
    advice: 'Er worden sneeuwbuien gemeld. Kleed je warm aan en let op gladheid.',
  }
  if (weatherCode >= 95 && weatherCode <= 99) return {
    icon: '⛈️',
    description: weatherCode >= 96 ? 'Onweer met hagel' : 'Onweer',
    advice: 'Er wordt onweer gemeld. Volg aanwijzingen van de organisatie en zoek een veilige binnenlocatie.',
  }
  return {
    icon: '🌡️',
    description: 'Actueel weer',
    advice: 'Controleer voor vertrek ook de actuele omstandigheden buiten.',
  }
}

type WeatherCacheEntry = { fetchedAt: number; weather: WeatherInfo; hourly?: HourlyWeather[] }

type HourlyWeather = {
  time: string
  weather: WeatherInfo
}

type WeatherForecast = {
  current: WeatherInfo | null
  hourly: HourlyWeather[]
}

type ProgrammeWeatherSelection = {
  day: ProgrammeDay
  item: ProgrammeDay['items'][number]
  weather: WeatherInfo | null
}

function readCachedWeatherEntry(): WeatherCacheEntry | null {
  try {
    const raw = window.localStorage.getItem(weatherCacheKey)
    if (!raw) return null
    const cached = JSON.parse(raw) as { fetchedAt?: number; weather?: WeatherInfo; hourly?: HourlyWeather[] }
    if (!cached.fetchedAt || !cached.weather || Date.now() - cached.fetchedAt >= weatherCacheLifetimeMs) return null
    return { fetchedAt: cached.fetchedAt, weather: cached.weather, hourly: cached.hourly ?? [] }
  } catch {
    return null
  }
}

function useAmsterdamWeather(): { forecast: WeatherForecast; unavailable: boolean } {
  const [forecast, setForecast] = useState<WeatherForecast>(() => {
    const cached = readCachedWeatherEntry() as (WeatherCacheEntry & { hourly?: HourlyWeather[] }) | null
    return { current: cached?.weather ?? null, hourly: cached?.hourly ?? [] }
  })
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    let controller: AbortController | null = null
    let refreshTimer = 0

    async function refreshWeather() {
      const cached = readCachedWeatherEntry()
      if (cached) {
        if (active) {
          setForecast({ current: cached.weather, hourly: (cached as WeatherCacheEntry & { hourly?: HourlyWeather[] }).hourly ?? [] })
          setUnavailable(false)
          refreshTimer = window.setTimeout(() => { void refreshWeather() }, Math.max(1_000, weatherCacheLifetimeMs - (Date.now() - cached.fetchedAt)))
        }
        return
      }

      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 8_000)
      try {
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=52.3676&longitude=4.9041&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day&timezone=Europe%2FAmsterdam&past_days=3&forecast_days=16', { signal: controller.signal })
        if (!response.ok) throw new Error('Weather request failed')
        const data = await response.json()
        const temperature = Number(data?.current?.temperature_2m)
        const weatherCode = Number(data?.current?.weather_code)
        const isDay = Number(data?.current?.is_day) === 1
        if (!Number.isFinite(temperature) || !Number.isInteger(weatherCode)) throw new Error('Invalid weather response')
        const nextWeather = { temperature: Math.round(temperature), weatherCode, ...describeWeather(weatherCode, temperature, isDay) }
        const hourlyTimes = Array.isArray(data?.hourly?.time) ? data.hourly.time : []
        const hourlyTemperatures = Array.isArray(data?.hourly?.temperature_2m) ? data.hourly.temperature_2m : []
        const hourlyCodes = Array.isArray(data?.hourly?.weather_code) ? data.hourly.weather_code : []
        const hourlyIsDay = Array.isArray(data?.hourly?.is_day) ? data.hourly.is_day : []
        const hourly = hourlyTimes.flatMap((time: unknown, index: number): HourlyWeather[] => {
          const hourlyTemperature = Number(hourlyTemperatures[index])
          const hourlyCode = Number(hourlyCodes[index])
          if (typeof time !== 'string' || !Number.isFinite(hourlyTemperature) || !Number.isInteger(hourlyCode)) return []
          return [{
            time,
            weather: {
              temperature: Math.round(hourlyTemperature),
              weatherCode: hourlyCode,
              ...describeWeather(hourlyCode, hourlyTemperature, Number(hourlyIsDay[index]) === 1),
            },
          }]
        })
        if (!active) return
        setForecast({ current: nextWeather, hourly })
        setUnavailable(false)
        try {
          window.localStorage.setItem(weatherCacheKey, JSON.stringify({ fetchedAt: Date.now(), weather: nextWeather, hourly }))
        } catch {
          // Het weer blijft bruikbaar wanneer lokale opslag niet beschikbaar is.
        }
        refreshTimer = window.setTimeout(() => { void refreshWeather() }, weatherCacheLifetimeMs)
      } catch {
        if (active) {
          setForecast({ current: null, hourly: [] })
          setUnavailable(true)
          refreshTimer = window.setTimeout(() => { void refreshWeather() }, 5 * 60 * 1000)
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void refreshWeather()

    return () => {
      active = false
      controller?.abort()
      window.clearTimeout(refreshTimer)
    }
  }, [])

  return { forecast, unavailable }
}

function getProgrammeWeather(forecast: WeatherForecast, dayId: ProgrammeDay['id'], time: string): WeatherInfo | null {
  const [hour, minute] = time.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const nearestHour = minute >= 30 ? hour + 1 : hour
  const date = new Date(`${introDateByDay[dayId]}T00:00:00+02:00`)
  if (nearestHour >= 24) date.setDate(date.getDate() + 1)
  const dateKey = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const hourKey = String(nearestHour % 24).padStart(2, '0')
  return forecast.hourly.find((entry) => entry.time === `${dateKey}T${hourKey}:00`)?.weather ?? null
}

function ProgrammeWeatherButton({
  day,
  item,
  forecast,
  onOpen,
}: {
  day: ProgrammeDay
  item: ProgrammeDay['items'][number]
  forecast: WeatherForecast
  onOpen: (selection: ProgrammeWeatherSelection) => void
}) {
  const weather = getProgrammeWeather(forecast, day.id, item.time)
  return (
    <button
      type="button"
      className="programme-weather-button"
      aria-label={`Weersverwachting voor ${item.title} om ${item.time}`}
      title={`Weersverwachting om ${item.time}`}
      onClick={() => onOpen({ day, item, weather })}
    >
      <span aria-hidden="true">{weather?.icon ?? '🌡️'}</span>
    </button>
  )
}

export function CountryFlagIcon({ country, size = 32 }: { country: string; size?: number }) {
  const code = country.toLowerCase()
  if (code.includes('austral') || country === 'AU') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <circle cx="16" cy="16" r="16" fill="#00008b" />
        <path d="M0 0 L16 16 M16 0 L0 16" stroke="#ffffff" strokeWidth="3" />
        <path d="M0 0 L16 16 M16 0 L0 16" stroke="#cc0000" strokeWidth="1.5" />
        <path d="M8 0 V16 M0 8 H16" stroke="#ffffff" strokeWidth="5" />
        <path d="M8 0 V16 M0 8 H16" stroke="#cc0000" strokeWidth="3" />
        <circle cx="8" cy="24" r="3.5" fill="#ffffff" />
        <circle cx="24" cy="8" r="1.5" fill="#ffffff" />
        <circle cx="28" cy="14" r="1.5" fill="#ffffff" />
        <circle cx="24" cy="20" r="1.5" fill="#ffffff" />
        <circle cx="19" cy="16" r="1.5" fill="#ffffff" />
        <circle cx="22" cy="24" r="2" fill="#ffffff" />
      </svg>
    )
  }
  if (code.includes('canada') || country === 'CA') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <rect x="0" y="0" width="8" height="32" fill="#ff0000" />
        <rect x="8" y="0" width="16" height="32" fill="#ffffff" />
        <rect x="24" y="0" width="8" height="32" fill="#ff0000" />
        <path d="M16 7 L18 12 L21 11 L19 15 L22 17 L18 18 L19 22 L16 20 L13 22 L14 18 L10 17 L13 15 L11 11 L14 12 Z" fill="#ff0000" />
      </svg>
    )
  }
  if (code.includes('frank') || country === 'FR') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <rect x="0" y="0" width="10.6" height="32" fill="#0055a5" />
        <rect x="10.6" y="0" width="10.8" height="32" fill="#ffffff" />
        <rect x="21.4" y="0" width="10.6" height="32" fill="#ef4135" />
      </svg>
    )
  }
  if (code.includes('brazi') || country === 'BR') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <circle cx="16" cy="16" r="16" fill="#009c3b" />
        <polygon points="16,5 28,16 16,27 4,16" fill="#ffdf00" />
        <circle cx="16" cy="16" r="6.5" fill="#002776" />
        <path d="M10 17 Q 16 13 22 17" stroke="#ffffff" strokeWidth="1.2" fill="none" />
      </svg>
    )
  }
  if (code.includes('griek') || country === 'GR') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <circle cx="16" cy="16" r="16" fill="#0d5eaf" />
        <path d="M0 7 H32 M0 14 H32 M0 21 H32 M0 28 H32" stroke="#ffffff" strokeWidth="3.5" />
        <rect x="0" y="0" width="16" height="16" fill="#0d5eaf" />
        <path d="M8 0 V16 M0 8 H16" stroke="#ffffff" strokeWidth="3.5" />
      </svg>
    )
  }
  if (code.includes('dene') || country === 'DK') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <circle cx="16" cy="16" r="16" fill="#c8102e" />
        <path d="M11 0 V32 M0 16 H32" stroke="#ffffff" strokeWidth="4" />
      </svg>
    )
  }
  if (code.includes('est') || country === 'EE') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <rect x="0" y="0" width="32" height="10.6" fill="#0072ce" />
        <rect x="0" y="10.6" width="32" height="10.8" fill="#000000" />
        <rect x="0" y="21.4" width="32" height="10.6" fill="#ffffff" />
      </svg>
    )
  }
  if (code.includes('honga') || country === 'HU') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
        <rect x="0" y="0" width="32" height="10.6" fill="#ce2939" />
        <rect x="0" y="10.6" width="32" height="10.8" fill="#ffffff" />
        <rect x="0" y="21.4" width="32" height="10.6" fill="#477050" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ borderRadius: '50%', flex: '0 0 auto', display: 'block' }}>
      <rect x="0" y="0" width="32" height="10.6" fill="#ae1c28" />
      <rect x="0" y="10.6" width="32" height="10.8" fill="#ffffff" />
      <rect x="0" y="21.4" width="32" height="10.6" fill="#21468b" />
    </svg>
  )
}

const navItems = [
  { label: 'Vandaag', icon: Clock3 },
  { label: 'Programma', icon: CalendarDays },
  { label: 'Kaart', icon: Map },
  { label: 'Strijd', icon: Trophy },
  { label: 'Meer', icon: Ellipsis },
] as const

type NavLabel = (typeof navItems)[number]['label']
type MoreSectionId = 'notifications' | 'practical' | 'discounts' | 'pov' | 'help' | 'settings' | 'import'

const introDateByDay: Record<ProgrammeDay['id'], string> = {
  dinsdag: '2026-08-25',
  woensdag: '2026-08-26',
  donderdag: '2026-08-27',
}

const enterDayIdentity: Record<ProgrammeDay['id'], { label: string; shortLabel: string }> = {
  dinsdag: { label: 'ENTER DAY 1 — Meet', shortLabel: 'Meet' },
  woensdag: { label: 'ENTER DAY 2 — eXperience', shortLabel: 'eXperience' },
  donderdag: { label: 'ENTER DAY 3 — eXplore & Celebrate', shortLabel: 'eXplore' },
}

function getAmsterdamMoment(referenceDate: Date) {
  const parts = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(referenceDate)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''

  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
    hour: Number(part('hour')),
  }
}

function getProgrammeStart(dayId: ProgrammeDay['id'], time: string) {
  return new Date(`${introDateByDay[dayId]}T${time}:00+02:00`)
}

function formatProgrammeCountdown(millisecondsUntilStart: number, beforeIntroweek: boolean) {
  const totalMinutes = Math.max(1, Math.ceil(millisecondsUntilStart / 60_000))

  if (beforeIntroweek && totalMinutes >= 24 * 60) {
    const days = Math.ceil(totalMinutes / (24 * 60))
    return `Introweek start over ${days} ${days === 1 ? 'dag' : 'dagen'}`
  }

  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes > 0
      ? `Start over ${hours} uur en ${minutes} ${minutes === 1 ? 'minuut' : 'minuten'}`
      : `Start over ${hours} uur`
  }

  return `Start over ${totalMinutes} ${totalMinutes === 1 ? 'minuut' : 'minuten'}`
}

function getHomeProgramme(referenceDate: Date, programmeDays: ProgrammeDay[]) {
  const dayId = getDefaultIntroDayId(referenceDate)
  const dayIndex = programmeDays.findIndex((pDay) => pDay.id === dayId)
  const day = programmeDays[dayIndex >= 0 ? dayIndex : 0]
  const now = getAmsterdamMoment(referenceDate)
  const eventDate = introDateByDay[day.id]
  const itemMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number)
    return hours * 60 + minutes
  }

  let currentIndex = -1
  let nextIndex = 0
  let finished = false

  if (now.date === eventDate) {
    const upcomingIndex = day.items.findIndex((item) => itemMinutes(item.time) > now.minutes)
    if (upcomingIndex === -1) {
      const lastItem = day.items[day.items.length - 1]
      const lastItemTime = itemMinutes(lastItem.time)
      if (now.minutes >= lastItemTime && now.minutes < lastItemTime + 90) {
        currentIndex = day.items.length - 1
      } else {
        finished = true
      }
      nextIndex = day.items.length - 1
    } else if (upcomingIndex === 0) {
      currentIndex = -1
      nextIndex = 0
    } else {
      const prevItem = day.items[upcomingIndex - 1]
      const prevTime = itemMinutes(prevItem.time)
      if (now.minutes >= prevTime) {
        currentIndex = upcomingIndex - 1
      }
      nextIndex = upcomingIndex
    }
  } else if (now.date > eventDate) {
    finished = true
    nextIndex = day.items.length - 1
  }

  const currentItem = currentIndex >= 0 ? day.items[currentIndex] : null
  const isCurrentlyActive = Boolean(currentItem)

  const nextDay = finished && dayIndex < programmeDays.length - 1 ? programmeDays[dayIndex + 1] : null
  const introweekCompleted = finished && dayIndex === programmeDays.length - 1

  const activeItem = isCurrentlyActive
    ? currentItem!
    : finished && nextDay
      ? nextDay.items[0]
      : day.items[nextIndex]

  const activeDay = finished && nextDay ? nextDay : day
  const millisecondsUntilStart = getProgrammeStart(activeDay.id, activeItem.time).getTime() - referenceDate.getTime()
  const firstProgrammeStart = getProgrammeStart(programmeDays[0].id, programmeDays[0].items[0].time)
  const beforeIntroweek = referenceDate.getTime() < firstProgrammeStart.getTime()
  const status = introweekCompleted
    ? 'Eindklassement bekend · Bedankt voor je inzet!'
    : isCurrentlyActive
      ? 'Nu bezig'
      : millisecondsUntilStart > 0
        ? formatProgrammeCountdown(millisecondsUntilStart, beforeIntroweek)
        : `Start om ${activeItem.time}`

  const greeting = now.hour < 12 ? 'Goedemorgen' : now.hour < 18 ? 'Goedemiddag' : 'Goedenavond'

  return {
    day,
    nextDay,
    introweekCompleted,
    activeItem,
    currentItem,
    currentIndex,
    nextItem: day.items[nextIndex],
    nextIndex,
    isCurrentlyActive,
    finished,
    status,
    greeting,
  }
}

function ProgrammeView({
  programmeDays,
  weatherForecast,
  onOpenWeather,
}: {
  programmeDays: ProgrammeDay[]
  weatherForecast: WeatherForecast
  onOpenWeather: (selection: ProgrammeWeatherSelection) => void
}) {
  const profile = useAppProfile()
  const [selectedDayId, setSelectedDayId] = useState<ProgrammeDay['id']>(getDefaultIntroDayId)
  const selectedDay = programmeDays.find((day) => day.id === selectedDayId) ?? programmeDays[0]

  return (
    <section className="programme-view" aria-labelledby="programme-title">
      <div className="page-intro">
        <p className="eyebrow">ENTER THE PROGRAMME · {profile.classCode}</p>
        <h1 id="programme-title">Jouw programma</h1>
        <p>Alle tijden, locaties en routes voor jouw klas overzichtelijk bij elkaar.</p>
      </div>

      <div className="day-switcher" role="tablist" aria-label="Kies een introductiedag">
        {programmeDays.map((day) => (
          <button
            key={day.id}
            role="tab"
            aria-selected={selectedDay.id === day.id}
            className={selectedDay.id === day.id ? 'active' : ''}
            onClick={() => setSelectedDayId(day.id)}
          >
            <span>{day.shortLabel}</span>
            <small>{enterDayIdentity[day.id].shortLabel}</small>
          </button>
        ))}
      </div>

      <article className="day-overview">
        <div className="day-overview-heading">
          <div>
            <p className="enter-day-title">{enterDayIdentity[selectedDay.id].label}</p>
            <span className="day-date">{selectedDay.date}</span>
            <h2>{selectedDay.title}</h2>
          </div>
          <CalendarDays aria-hidden="true" />
        </div>
        <p>{selectedDay.summary}</p>
      </article>

      <ol className="programme-list">
        {selectedDay.items.map((item) => (
          <li key={`${selectedDay.id}-${item.time}-${item.title}`}>
            <time>{item.time}</time>
            <div className="programme-activity">
              <span className="activity-category">{item.category}</span>
              <h3>{item.title}</h3>
              {item.location && (
                <p><MapPin aria-hidden="true" />{item.location}</p>
              )}
              {item.routeUrl && (
                <a href={item.routeUrl} target="_blank" rel="noreferrer">
                  <Navigation aria-hidden="true" /> Route openen
                </a>
              )}
            </div>
            <ProgrammeWeatherButton day={selectedDay} item={item} forecast={weatherForecast} onOpen={onOpenWeather} />
          </li>
        ))}
      </ol>

      <p className="programme-note">Wijzigt er iets? Dan verschijnt de actuele informatie automatisch bovenaan.</p>
    </section>
  )
}

function ProgrammeWeatherModal({ selection, onClose }: { selection: ProgrammeWeatherSelection; onClose: () => void }) {
  const { day, item, weather } = selection

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="weather-modal-overlay" role="presentation" onClick={onClose}>
      <div className="weather-modal-content" role="dialog" aria-modal="true" aria-labelledby="weather-modal-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="weather-modal-close" onClick={onClose} aria-label="Weersverwachting sluiten"><X aria-hidden="true" /></button>
        <aside className="weather-widget-card programme-weather-popup">
          <div className="weather-widget-header">
            <span className="weather-widget-icon" aria-hidden="true">{weather?.icon ?? '🌡️'}</span>
            <div>
              <strong id="weather-modal-title">{weather ? `${weather.temperature}°C in Amsterdam · ${weather.description}` : 'Verwachting nog niet beschikbaar'}</strong>
              <span className="weather-source-tag">{day.shortLabel} om {item.time} · {item.title}</span>
            </div>
          </div>
          <p className="weather-widget-advice">{weather?.advice ?? 'Open-Meteo heeft voor dit moment nog geen uurverwachting gepubliceerd. Probeer het later opnieuw.'}</p>
          <span className="weather-popup-source">Open-Meteo · maximaal 30 minuten lokaal gecachet</span>
        </aside>
      </div>
    </div>
  )
}

function MapView({ routeDays }: { routeDays: RouteDay[] }) {
  const [selectedDayId, setSelectedDayId] = useState<RouteDay['id']>(getDefaultIntroDayId)
  const selectedDay = routeDays.find((day) => day.id === selectedDayId) ?? routeDays[0]
  const mapBounds = { minLat: 52.335, maxLat: 52.41, minLon: 4.8, maxLon: 5.0 }
  const markerPosition = (latitude: number, longitude: number) => ({
    left: `${((longitude - mapBounds.minLon) / (mapBounds.maxLon - mapBounds.minLon)) * 100}%`,
    top: `${((mapBounds.maxLat - latitude) / (mapBounds.maxLat - mapBounds.minLat)) * 100}%`,
  })

  return (
    <section className="map-view" aria-labelledby="map-title">
      <div className="page-intro">
        <p className="eyebrow">ENTER AMSTERDAM</p>
        <h1 id="map-title">Op pad in Amsterdam</h1>
        <p>Bekijk je route zonder zware online kaart. Open Google Maps alleen wanneer je echt wilt navigeren.</p>
      </div>

      <div className="day-switcher" role="tablist" aria-label="Kies een route per dag">
        {routeDays.map((day) => (
          <button
            key={day.id}
            role="tab"
            aria-selected={selectedDay.id === day.id}
            className={selectedDay.id === day.id ? 'active' : ''}
            onClick={() => setSelectedDayId(day.id)}
          >
            <span>{day.shortLabel}</span>
            <small>aug</small>
          </button>
        ))}
      </div>

      <div className="route-canvas" aria-label={`Kaart van Amsterdam met locaties voor ${selectedDay.shortLabel}`}>
        <img className="route-map" src={`${import.meta.env.BASE_URL}amsterdam-map.svg`} alt="" aria-hidden="true" />
        {selectedDay.stops.map((stop) => (
          <span
            key={`${selectedDay.id}-${stop.number}`}
            className="map-marker"
            style={markerPosition(stop.latitude, stop.longitude)}
            aria-hidden="true"
          >
            <b>{stop.number}</b>
          </span>
        ))}
      </div>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap-bijdragers · ODbL
      </a>

      <div className="route-heading">
        <div>
          <p className="eyebrow">Jouw route</p>
          <h2>{selectedDay.label}</h2>
        </div>
        <Compass aria-hidden="true" />
      </div>

      <ol className="route-list">
        {selectedDay.stops.map((stop) => (
          <li key={`${selectedDay.id}-${stop.number}-${stop.title}`} className="route-card">
            <div className="route-card-header">
              <span className="route-stop-badge">Stop {stop.number}</span>
              <time className="route-stop-time"><Clock3 aria-hidden="true" /> {stop.time}</time>
            </div>
            <div className="route-card-body">
              <h3>{stop.title}</h3>
              <p><MapPin aria-hidden="true" /> {stop.address}</p>
            </div>
            <a href={stop.routeUrl} target="_blank" rel="noreferrer" className="route-action-button" aria-label={`Route naar ${stop.title} openen in Google Maps`}>
              <Navigation aria-hidden="true" /> Route openen in Maps
            </a>
          </li>
        ))}
      </ol>
      <p className="programme-note">Deze kaart staat lokaal in de app en gebruikt onderweg geen extra kaartdata. Alleen ‘Route openen’ start Google Maps.</p>
    </section>
  )
}

type CompetitionViewProps = {
  onNavigate: (destination: NavLabel, moreSection?: MoreSectionId) => void
}

function CompetitionView({ onNavigate }: CompetitionViewProps) {
  const profile = useAppProfile()
  const [selectedTeam, setSelectedTeam] = useState<Standing | null>(null)
  const leader = standings[0]
  const isOrganizer = profile.profileType === 'organizer'
  const ownTeam = standings.find((team) => team.classCode === profile.classCode) ?? standings[1]
  const isPreStart = leader.points === 0
  const tiedLeaders = standings.filter((team) => team.points === leader.points)
  const isSoleLeader = !isPreStart && tiedLeaders.length === 1 && ownTeam.points === leader.points
  const isTiedFirst = !isPreStart && tiedLeaders.length > 1 && ownTeam.points === leader.points
  const isLeader = isSoleLeader || isTiedFirst
  const otherTiedLeader = tiedLeaders.find((team) => team.classCode !== profile.classCode)
  const difference = leader.points - ownTeam.points

  return (
    <section className="competition-view" aria-labelledby="competition-title">
      <div className="page-intro">
        <p className="eyebrow">ENTER THE CHALLENGE{isOrganizer ? ' · ORGANISATIE' : ''}</p>
        <h1 id="competition-title">{isOrganizer ? 'Live Klassement' : `Samen voor ${profile.country}`}</h1>
        <p>{isOrganizer ? 'Houd de punten en tussenstand bij van alle deelnemende klassen.' : `Iedere opdracht telt. Werk samen met ${profile.classCode} en klim naar de eerste plaats.`}</p>
      </div>

      <article className={`team-hero ${isOrganizer || isLeader ? 'is-leader' : ''}`}>
        <div className="team-hero-header">
          <div className="hero-flag-wrapper waving-flag" aria-hidden="true">
            <CountryFlagIcon country={isOrganizer ? 'Nederland' : profile.country} size={50} />
            <div className="flag-wave-sheen" />
          </div>
          <div className="hero-class-tag">
            <span className="hero-class-code">{isOrganizer ? 'Organisatie & Jury' : `Jouw land · ${profile.classCode}`}</span>
            <strong className="hero-country-name">{isOrganizer ? 'Inholland Introweek 2026' : profile.country}</strong>
          </div>
        </div>

        <div className="team-hero-stats">
          <div className="hero-stat-card rank">
            <span className="stat-label">{isOrganizer ? 'Koploper' : 'Positie'}</span>
            <strong className="stat-value">
              {isOrganizer
                ? `${leader.country} (${leader.classCode})`
                : isPreStart
                  ? 'Startpositie 🏁'
                  : isSoleLeader
                    ? '1e Plaats 👑'
                    : isTiedFirst
                      ? 'Gedeeld 1e 🤝'
                      : `${ownTeam.rank}e Plaats`}
            </strong>
          </div>
          <div className="hero-stat-card points">
            <span className="stat-label">{isOrganizer ? 'Hoogste score' : 'Score'}</span>
            <strong className="stat-value">{isOrganizer ? leader.points : ownTeam.points} <small>punten</small></strong>
          </div>
        </div>

        <div className="hero-chaser-banner">
          {isOrganizer ? (
            <span>Beoordeel foto's en ken punten toe via het <b>Organisatiedashboard</b>.</span>
          ) : isPreStart ? (
            <span>🚀 De Landenstrijd gaat bijna van start! Scoor de eerste punten voor {profile.country}! 🔥</span>
          ) : isSoleLeader ? (
            <span>👑 Jullie staan alleen op de 1e plaats! Houd de voorsprong vast! 🔥</span>
          ) : isTiedFirst ? (
            <span>🤝 Gedeelde 1e plaats met {otherTiedLeader?.country}! Pak de leiding! 🔥</span>
          ) : (
            <span>Nog <b>{difference} {difference === 1 ? 'punt' : 'punten'}</b> tot koploper {leader.country}</span>
          )}
        </div>
      </article>

      <div className="score-meta">
        <span><i className="status-pulse" /> Live klassement</span>
        <small>💡 Tik op een land voor de exacte puntenopbouw</small>
      </div>

      <ol className="leaderboard" aria-label="Klassement van de landenstrijd">
        {standings.map((team) => {
          const isOwnTeam = !isOrganizer && team.classCode === profile.classCode
          const medalEmoji = team.rank === 1 ? '🥇' : team.rank === 2 ? '🥈' : team.rank === 3 ? '🥉' : null
          return (
            <li
              key={team.classCode}
              className={`rank-${team.rank} ${isOwnTeam ? 'own-team' : ''} clickable-team-row`}
              onClick={() => setSelectedTeam(team)}
              title={`Klik om puntenopbouw van ${team.country} te bekijken`}
              role="button"
              tabIndex={0}
            >
              <span className="standing-rank-badge" aria-label={`Rang ${team.rank}`}>
                {medalEmoji ? <span className="medal-icon">{medalEmoji}</span> : <span className="rank-num">{team.rank}</span>}
              </span>
              <span className="standing-flag-box">
                <CountryFlagIcon country={team.country} size={32} />
              </span>
              <span className="standing-team">
                <div className="standing-team-header">
                  <strong>{team.country}</strong>
                  <ChevronRight className="team-row-arrow" aria-hidden="true" />
                </div>
                <small>{team.classCode}</small>
                <span className="score-track" aria-hidden="true">
                  <i style={{ width: `${Math.round((team.points / leader.points) * 100)}%` }} />
                </span>
              </span>
              <span className="standing-points">
                <b>{team.points}</b>
                <small>punten</small>
              </span>
            </li>
          )
        })}
      </ol>

      {/* TEAM SCORE BREAKDOWN MODAL */}
      {selectedTeam && (
        <div className="modal-overlay" onClick={() => setSelectedTeam(null)}>
          <div className="modal-dialog-card score-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <div className="modal-title-with-flag">
                <CountryFlagIcon country={selectedTeam.country} size={38} />
                <div>
                  <h2>{selectedTeam.country} ({selectedTeam.classCode})</h2>
                  <span className="score-modal-rank-badge">Plaats #{selectedTeam.rank} · <b>{selectedTeam.points} punten</b></span>
                </div>
              </div>
              <button type="button" className="close-modal-icon-btn" onClick={() => setSelectedTeam(null)} aria-label="Sluiten">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="modal-dialog-body">
              <div className="score-history-header">
                <h3>Puntenhistorie &amp; Opbouw</h3>
                <p>Overzicht van alle toegekende punten door de organisatie en jury.</p>
              </div>

              <div className="score-history-list">
                {(selectedTeam.history ?? defaultScoreHistories[selectedTeam.classCode] ?? []).map((entry: TeamScoreHistory, idx: number) => (
                  <div key={entry.id || idx} className="score-history-card">
                    <div className="score-badge-col">
                      <span className="points-pill">+{entry.points} pt</span>
                    </div>
                    <div className="score-info-col">
                      <strong>{entry.title}</strong>
                      <div className="score-meta-line">
                        <span className={`score-cat-tag cat-${entry.category.toLowerCase().replace(/[^a-z]/g, '')}`}>
                          {entry.category}
                        </span>
                        <small>{entry.awardedAt}</small>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-dialog-footer">
              <button type="button" className="close-modal-text-btn" onClick={() => setSelectedTeam(null)}>
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="points-section" aria-labelledby="points-title">
        <div className="route-heading">
          <div>
            <p className="eyebrow">ENTER THE CHALLENGE</p>
            <h2 id="points-title">Kansen voor je klas</h2>
          </div>
        </div>
        <div className="points-grid">
          <button type="button" onClick={() => onNavigate('Meer', 'pov')}><Camera aria-hidden="true" /><div><strong>POV-foto’s</strong><span>Bekijk en plaats inzendingen</span></div><ChevronRight aria-hidden="true" /></button>
          <button type="button" onClick={() => onNavigate('Programma')}><Compass aria-hidden="true" /><div><strong>Experiences</strong><span>Bekijk waar en wanneer</span></div><ChevronRight aria-hidden="true" /></button>
          <button type="button" onClick={() => onNavigate('Kaart')}><Map aria-hidden="true" /><div><strong>City Game</strong><span>Open locaties en routes</span></div><ChevronRight aria-hidden="true" /></button>
          <button type="button" onClick={() => onNavigate('Meer', 'notifications')}><Trophy aria-hidden="true" /><div><strong>Bonuspunten</strong><span>Bekijk acties en berichten</span></div><ChevronRight aria-hidden="true" /></button>
        </div>
      </section>

      <p className="programme-note">Een nieuwe stand wordt later alleen opgehaald na een echte puntenwijziging. Er komt geen continue polling.</p>
    </section>
  )
}

type MoreViewProps = {
  selected: MoreSectionId
  onSelect: (section: MoreSectionId) => void
  notifications: AppNotification[]
  unreadCount: number
  notificationsLoading: boolean
  notificationsError: string
  onRefreshNotifications: () => void
  onMarkNotificationRead: (notificationId: string) => void
  onMarkAllNotificationsRead: () => void
  content: MasterContent | null
  contentVersion: number
  onContentUpdated: () => void
  largeText: boolean
  onToggleLargeText: () => void
  isWidescreen?: boolean
  onToggleWidescreen?: () => void
}

function formatNotificationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfNotificationDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDifference = Math.round((startOfToday - startOfNotificationDay) / 86_400_000)

  if (dayDifference === 0) {
    return new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (dayDifference === 1) return 'Gisteren'

  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(date)
}

function ContactHelpPanel({ classAppUrl }: { classAppUrl: string | null }) {
  const profile = useAppProfile()
  const [contacts, setContacts] = useState<ClassContact[]>([])
  const [loading, setLoading] = useState(Boolean(profile.id))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile.id || !profile.classCode) {
      setContacts([])
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    fetchClassContacts(profile.id)
      .then((nextContacts) => {
        if (active) setContacts(nextContacts)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'De contactpersonen kunnen nu niet worden opgehaald.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [profile.classCode, profile.id])

  const buddies = contacts.filter((contact) => contact.role === 'buddy')
  const poers = contacts.filter((contact) => contact.role === 'poer')

  return (
    <>
      <div className="more-panel-heading"><div><p className="eyebrow">ENTER YOUR NETWORK</p><h2>Contact &amp; hulp</h2></div><CircleHelp aria-hidden="true" /></div>
      {loading && <div className="notification-state" aria-live="polite">Contactpersonen ophalen...</div>}
      {error && <div className="notification-state notification-error" role="alert"><p>{error}</p></div>}
      {!loading && !error && (
        profile.classCode ? <div className="contact-list">
          <article>
            <strong>{profile.profileType === 'buddy' ? 'Buddyteam' : `Jouw buddy${buddies.length === 1 ? '' : "'s"}`}</strong>
            {buddies.length ? buddies.map((contact) => (
              <a key={contact.id} className="contact-action" href={`mailto:${contact.email}`}>
                <span><b>{contact.displayName}</b><small>{contact.email}</small></span><Mail aria-hidden="true" />
              </a>
            )) : <span>{profile.profileType === 'buddy' ? `Jij bent de enige buddy van ${profile.classCode}.` : `Er is nog geen buddy aan ${profile.classCode} gekoppeld.`}</span>}
          </article>
          <article>
            <strong>Jouw PO'er</strong>
            {poers.length ? poers.map((contact) => (
              <a key={contact.id} className="contact-action" href={`mailto:${contact.email}`}>
                <span><b>{contact.displayName}</b><small>{contact.email}</small></span><Mail aria-hidden="true" />
              </a>
            )) : <span>{profile.profileType === 'poer' ? `Jij bent de PO'er van ${profile.classCode}.` : `Er is nog geen PO'er aan ${profile.classCode} gekoppeld.`}</span>}
          </article>
          <article>
            <strong>Klassenapp</strong>
            {classAppUrl ? (
              <a className="contact-action" href={classAppUrl} target="_blank" rel="noreferrer">
                <span><b>Open de klassenapp</b><small>Voor vragen, vertragingen en contact met je klas</small></span><ChevronRight aria-hidden="true" />
              </a>
            ) : <span>De organisatie heeft nog geen klassenapp aan {profile.classCode} gekoppeld.</span>}
          </article>
        </div> : <div className="contact-list">
          <article>
            <strong>Contact met de organisatie</strong>
            <span>Je bent niet aan een klas gekoppeld. Algemene contactinformatie en belangrijke updates ontvang je via Meldingen.</span>
          </article>
        </div>
      )}
      <p className="emergency-note"><strong>Spoed?</strong> Bel bij een noodsituatie altijd 112.</p>
    </>
  )
}

function MoreView({
  selected,
  onSelect,
  notifications,
  unreadCount,
  notificationsLoading,
  notificationsError,
  onRefreshNotifications,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  content,
  contentVersion,
  onContentUpdated,
  largeText,
  onToggleLargeText,
  isWidescreen = false,
  onToggleWidescreen,
}: MoreViewProps) {
  const profile = useAppProfile()
  const logout = useProfileLogout()
  const [notificationPreview, setNotificationPreview] = useState(true)
  const [vibrationEnabled, setVibrationEnabled] = useState(true)
  const classItems = Array.isArray(content?.classes) ? content.classes : []
  const classContent = classItems.find((item) => item.active && item.classCode === profile.classCode) ?? null
  const practicalItems = content
    ? (Array.isArray(content.practical) ? content.practical : []).filter((item) => item.active).sort((left, right) => left.order - right.order)
    : null
  const discountItems = content
    ? (Array.isArray(content.discounts) ? content.discounts : []).filter((item) => item.active).sort((left, right) => left.name.localeCompare(right.name, 'nl'))
    : null
  const settingIsEnabled = (key: string) => {
    const value = content?.settings?.[key]
    return !['nee', 'false', '0', 'uit'].includes(typeof value === 'string' ? value.trim().toLowerCase() : '')
  }
  const configuredPovAssignments = (Array.isArray(content?.povAssignments) ? content.povAssignments : []).filter((assignment) => assignment.active)
  const activePovAssignments = configuredPovAssignments.filter((assignment) => new Date(assignment.deadlineAt).getTime() >= Date.now())
  const visiblePovAssignments = profile.profileType === 'organizer'
    ? configuredPovAssignments
    : activePovAssignments.filter((assignment) => assignment.classCodes === 'all' || assignment.classCodes.includes(profile.classCode))
  const practicalVisible = settingIsEnabled('toon_praktisch') && (content === null || Boolean(practicalItems?.length))
  const discountsVisible = settingIsEnabled('toon_kortingen') && (content === null || Boolean(discountItems?.length))
  const povVisible = settingIsEnabled('toon_pov') && !['poer', 'interested_teacher'].includes(profile.profileType) && (
    content === null || Boolean(visiblePovAssignments.length) || Boolean(classContent?.povUrl)
  )
  const sections: Array<{ id: MoreSectionId; label: string; detail: string; icon: typeof Bell }> = [
    {
      id: 'notifications' as const,
      label: 'Meldingen',
      detail: unreadCount > 0 ? `${unreadCount} nieuw` : 'Alles gelezen',
      icon: Bell,
    },
    { id: 'help' as const, label: 'Contact & hulp', detail: 'Snel iemand vinden', icon: CircleHelp },
    { id: 'settings' as const, label: 'Instellingen', detail: 'Meldingen & tekst', icon: Settings },
  ]
  if (practicalVisible) sections.splice(1, 0, { id: 'practical', label: 'Praktisch', detail: 'Alles bij de hand', icon: CheckCircle2 })
  if (discountsVisible) sections.splice(practicalVisible ? 2 : 1, 0, { id: 'discounts', label: 'Kortingen', detail: 'Met je polsbandje', icon: BadgePercent })
  if (povVisible) sections.splice((practicalVisible ? 1 : 0) + (discountsVisible ? 1 : 0) + 1, 0, { id: 'pov', label: 'POV-foto’s', detail: 'Verdien punten', icon: Camera })
  if (profile.profileType === 'organizer') {
    sections.push({ id: 'import', label: 'Organisatiedashboard', detail: 'Beheer & Excel-import', icon: ShieldCheck })
  }

  useEffect(() => {
    if ((selected === 'practical' && !practicalVisible)
      || (selected === 'discounts' && !discountsVisible)
      || (selected === 'pov' && !povVisible)) {
      onSelect('notifications')
    }
  }, [discountsVisible, onSelect, povVisible, practicalVisible, selected])

  return (
    <section className={`more-view${largeText ? ' large-text' : ''}`} aria-labelledby="more-title">
      <div className="page-intro">
        <p className="eyebrow">ENTER YOUR WEEK</p>
        <h1 id="more-title">Meer</h1>
        <p>Berichten, praktische informatie en persoonlijke instellingen op één plek.</p>
      </div>

      <article className="profile-card">
        <span className="profile-avatar" aria-hidden="true"><UserRound /></span>
        <span className="profile-copy">
          <small>Ingelogd als</small>
          <strong>{profile.displayName}</strong>
          <span>{[
            profile.profileType === 'student' ? 'Student'
              : profile.profileType === 'buddy' ? 'Buddy'
                : profile.profileType === 'poer' ? 'PO’er'
                  : profile.profileType === 'interested_teacher' ? 'Geïnteresseerde docent'
                    : 'Organisator',
            profile.classCode,
            `${profile.country} ${profile.flag}`.trim(),
          ].filter(Boolean).join(' · ')}</span>
        </span>
        <ShieldCheck aria-label="Profiel gekoppeld" />
      </article>

      <div className="more-menu" aria-label="Informatieonderdelen">
        {sections.map(({ id, label, detail, icon: Icon }) => (
          <button key={id} className={selected === id ? 'active' : ''} onClick={() => onSelect(id)}>
            <span className="more-menu-icon"><Icon aria-hidden="true" /></span>
            <span><strong>{label}</strong><small>{detail}</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="more-panel" aria-live="polite">
        {selected === 'notifications' && (
          <>
            <div className="more-panel-heading notification-heading">
              <div>
                <p className="eyebrow">{profile.profileType === 'organizer' ? 'ENTER THE CONTROL ROOM' : 'ENTER THE UPDATE'}</p>
                <h2>{profile.profileType === 'organizer' ? 'Organisatie Logboek' : 'Meldingen'}</h2>
              </div>
              <div className="notification-heading-actions">
                {profile.profileType === 'organizer' ? (
                  <span className="all-read-status">
                    <ShieldCheck aria-hidden="true" />
                    <span>Live Systeem-log</span>
                  </span>
                ) : unreadCount > 0 ? (
                  <>
                    <span className="unread-pill-badge">{unreadCount} nieuw</span>
                    <button type="button" className="mark-all-read-btn" onClick={onMarkAllNotificationsRead}>
                      <CheckCircle2 aria-hidden="true" />
                      <span>Alles als gelezen markeren</span>
                    </button>
                  </>
                ) : (
                  <span className="all-read-status">
                    <CheckCircle2 aria-hidden="true" />
                    <span>Alles gelezen</span>
                  </span>
                )}
              </div>
            </div>

            {profile.profileType === 'organizer' ? (
              <ul className="organizer-logs-list">
                {[
                  {
                    id: 'log-1',
                    time: 'Zojuist',
                    title: '📢 Waarschuwingsbericht & Banner verzonden',
                    body: '🌧️ Locatiewijziging ivm regen verzonden naar alle klassen via In-App notificatie & Brevo E-mail.',
                  },
                  {
                    id: 'log-2',
                    time: '14:30 uur',
                    title: '🏆 Punten toegekend & Stand geüpdatet',
                    body: '+150 punten toegekend aan klas LM1A voor foto "NDSM-terrein". Klassement automatisch bijgewerkt.',
                  },
                  {
                    id: 'log-3',
                    time: '13:00 uur',
                    title: '🕒 Programma overgeschakeld',
                    body: 'Automatisch overgeschakeld naar activiteit "Ontvangst eerstejaars" op Campus Inholland Sluisbuurt.',
                  },
                  {
                    id: 'log-4',
                    time: '11:15 uur',
                    title: '👥 Excel-import verwerkt',
                    body: 'Deelnemerslijst bijgewerkt: 8 studenten, 2 buddy\'s en 1 docent toegevoegd.',
                  },
                ].map((log) => (
                  <li key={log.id} className="organizer-log-item">
                    <div className="log-header">
                      <strong>{log.title}</strong>
                      <span className="log-time">{log.time}</span>
                    </div>
                    <p className="log-body">{log.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                {notificationsError && (
                  <div className="notification-state notification-error" role="alert">
                    <p>{notificationsError}</p>
                    <button type="button" onClick={onRefreshNotifications}>Opnieuw proberen</button>
                  </div>
                )}

                {notificationsLoading && notifications.length === 0 && (
                  <div className="notification-state" aria-live="polite">Meldingen ophalen…</div>
                )}

                {!notificationsLoading && !notificationsError && notifications.length === 0 && (
                  <div className="notification-state">
                    <Bell aria-hidden="true" />
                    <strong>Je bent helemaal bij</strong>
                    <span>Nieuwe persoonlijke berichten verschijnen hier.</span>
                  </div>
                )}

                {notifications.length > 0 && (
                  <ul className="notification-list">
                    {notifications.map((notification) => (
                      <li key={notification.id} className={notification.readAt ? '' : 'unread'}>
                        <button
                          type="button"
                          className="notification-item"
                          onClick={() => {
                            if (!notification.readAt) onMarkNotificationRead(notification.id)
                          }}
                          aria-label={`${notification.title}${notification.readAt ? '' : ', markeer als gelezen'}`}
                        >
                          <div className="notification-item-header">
                            <span className="notification-time-badge">
                              <Clock3 aria-hidden="true" />
                              <span>{formatNotificationTime(notification.createdAt)}</span>
                            </span>
                            {!notification.readAt && <span className="notification-unread-badge">Nieuw</span>}
                          </div>
                          <div className="notification-copy">
                            <strong>{notification.title}</strong>
                            <span>{notification.body}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}

        {selected === 'practical' && (
          <>
            <div className="more-panel-heading"><div><p className="eyebrow">Goed voorbereid</p><h2>Praktische informatie</h2></div><CheckCircle2 aria-hidden="true" /></div>
            <ul className="check-list">
              {(practicalItems ?? [
                { id: 'fallback-wristband', category: 'Toegang', title: 'Polsbandje', body: 'Draag het de hele introweek voor toegang en kortingen.' },
                { id: 'fallback-bring', category: 'Meenemen', title: 'Wat neem je mee?', body: 'Opgeladen telefoon, powerbank, water en bescherming tegen het weer.' },
                { id: 'fallback-late', category: 'Contact', title: 'Ben je later?', body: 'Stuur je naam, reden en verwachte aankomsttijd in de klassenapp.' },
              ]).map((item) => (
                <li key={item.id} className="check-item">
                  <div className="check-item-icon">
                    <CheckCircle2 aria-hidden="true" />
                  </div>
                  <div className="check-item-content">
                    <span className="check-item-badge">{item.category}</span>
                    <strong className="check-item-title">{item.title}</strong>
                    <p className="check-item-body">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            {practicalItems?.length === 0 && <p className="panel-footnote">Er staat momenteel geen praktische informatie actief.</p>}
          </>
        )}

        {selected === 'discounts' && (
          <>
            <div className="more-panel-heading"><div><p className="eyebrow">Studentendeals</p><h2>Kortingen</h2></div><BadgePercent aria-hidden="true" /></div>
            {discountItems === null && (
              <div className="info-callout"><strong>Houd je polsbandje om</strong><p>Daarmee bewijs je bij deelnemende locaties dat je recht hebt op de introweekkorting.</p></div>
            )}
            {discountItems && discountItems.length > 0 && (
              <ul className="discount-list">
                {discountItems.map((item) => (
                  <li key={item.id} className="discount-card">
                    <div className="discount-header">
                      <strong>{item.name}</strong>
                      <span className="discount-validity">Geldig {item.validFrom} t/m {item.validUntil}</span>
                    </div>
                    <p className="discount-description">{item.description}</p>
                    {item.address && <small className="discount-address"><MapPin aria-hidden="true" />{item.address}</small>}
                    {item.terms && <p className="discount-terms">{item.terms}</p>}
                    {item.routeUrl && (
                      <a className="discount-route-btn" href={item.routeUrl} target="_blank" rel="noreferrer">
                        <Navigation aria-hidden="true" /> Open route
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {discountItems?.length === 0 && <p className="panel-footnote">Er staan momenteel geen kortingen actief.</p>}
          </>
        )}

        {selected === 'pov' && (
          <>
            <div className="more-panel-heading"><div><p className="eyebrow">ENTER YOUR STORY</p><h2>POV-foto’s</h2></div><Camera aria-hidden="true" /></div>
            <PovPanel profile={profile} assignments={visiblePovAssignments} fallbackUrl={classContent?.povUrl ?? null} />
          </>
        )}

        {selected === 'help' && (
          <ContactHelpPanel classAppUrl={classContent?.classAppUrl ?? null} />
        )}

        {selected === 'settings' && (
          <>
            <div className="more-panel-heading"><div><p className="eyebrow">Persoonlijk</p><h2>Instellingen</h2></div><Settings aria-hidden="true" /></div>
            <div className="settings-list">
              <button
                className="settings-item"
                role="switch"
                aria-checked={notificationPreview}
                onClick={() => {
                  const nextValue = !notificationPreview
                  setNotificationPreview(nextValue)
                  if (nextValue && typeof window !== 'undefined' && 'Notification' in window) {
                    void Notification.requestPermission()
                  }
                }}
              >
                <div className="settings-copy">
                  <strong>Pushmeldingen op vergrendelscherm</strong>
                  <small>Ontvang live waarschuwingen en programma-updates</small>
                </div>
                <i className={notificationPreview ? 'toggle active' : 'toggle'}><b /></i>
              </button>

              <button
                className="settings-item"
                role="switch"
                aria-checked={vibrationEnabled}
                onClick={() => {
                  const nextValue = !vibrationEnabled
                  setVibrationEnabled(nextValue)
                  if (nextValue && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    navigator.vibrate([150, 80, 150])
                  }
                }}
              >
                <div className="settings-copy">
                  <strong>Telefoon trillen bij melding</strong>
                  <small>Trilfunctie gebruiken bij dringende updates</small>
                </div>
                <i className={vibrationEnabled ? 'toggle active' : 'toggle'}><b /></i>
              </button>

              <button className="settings-item" role="switch" aria-checked={largeText} onClick={onToggleLargeText}>
                <div className="settings-copy">
                  <strong>Grotere tekst</strong>
                  <small>Vergroot alle teksten en knoppen voor betere leesbaarheid</small>
                </div>
                <i className={largeText ? 'toggle active' : 'toggle'}><b /></i>
              </button>

              <button type="button" className="settings-item logout-action" onClick={logout}>
                <div className="settings-copy">
                  <strong style={{ color: '#e3004f' }}>Uitloggen</strong>
                  <small>Sluit je persoonlijke programma op dit apparaat</small>
                </div>
                <LogOut aria-hidden="true" style={{ color: '#e3004f' }} />
              </button>
            </div>
          </>
        )}

        {selected === 'import' && profile.profileType === 'organizer' && (
          <div className={isWidescreen ? 'widescreen-organizer-wrapper' : ''}>
            <OrganizerDashboard
              profile={profile}
              content={content}
              contentVersion={contentVersion}
              onContentUpdated={onContentUpdated}
              isWidescreen={isWidescreen}
              onToggleWidescreen={onToggleWidescreen}
            />
          </div>
        )}
      </div>

      <footer className="institutional-signature">
        <span className="signature-brand"><b>LM</b><i>=</i><strong>YOU</strong></span>
        <span>Een initiatief van Leisure &amp; Events Management Amsterdam</span>
        <small>Hogeschool Inholland</small>
      </footer>
    </section>
  )
}

function AnimatedBrandLogo({ firstName, onTriggerEnterX }: { firstName: string; onTriggerEnterX: () => void }) {
  const [showName, setShowName] = useState(false)
  const hideNameTimerRef = useRef<number | null>(null)

  function revealName() {
    if (!firstName || firstName.toUpperCase() === 'YOU') return
    if (hideNameTimerRef.current !== null) window.clearTimeout(hideNameTimerRef.current)
    setShowName(true)
    hideNameTimerRef.current = window.setTimeout(() => {
      setShowName(false)
      hideNameTimerRef.current = null
    }, 10_000)
  }

  useEffect(() => {
    if (!firstName || firstName.toUpperCase() === 'YOU') return

    const initialTimer = window.setTimeout(revealName, 3_000)
    const interval = window.setInterval(revealName, 120_000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
      if (hideNameTimerRef.current !== null) window.clearTimeout(hideNameTimerRef.current)
    }
  }, [firstName])

  const nameUpper = firstName.toUpperCase()

  return (
    <div className="brand-lockup" aria-label={`LM = YOU, LM = ${nameUpper}, Enter the X 2026`}>
      <button
        type="button"
        className="brand-mark brand-toggle"
        onClick={revealName}
        aria-label={`Toon LM = ${nameUpper}`}
      >
        <b>LM</b>
        <i className="brand-equals">=</i>
        <span className="brand-flip-container">
          <span className={`brand-you-text ${showName ? 'flip-out' : 'flip-in'}`}>YOU</span>
          <span className={`brand-name-text ${showName ? 'flip-in' : 'flip-out'}`}>{nameUpper}</span>
        </span>
      </button>
      <button
        type="button"
        className="brand-edition"
        onClick={onTriggerEnterX}
        aria-label="Start de ENTER THE X-animatie"
      >
        <span>ENTER THE</span><b>X</b><small>2026</small>
      </button>
    </div>
  )
}

function App() {
  const profile = useAppProfile()
  const masterContent = useMasterContent()
  const { forecast: weatherForecast } = useAmsterdamWeather()
  const currentProgrammeDays = buildProgrammeDays(masterContent.content, profile.classCode)
  const currentRouteDays = buildRouteDays(masterContent.content, profile.classCode)
  const notificationInbox = useNotifications(profile.id, profile.classCode, profile.profileType, masterContent.content?.messages)
  const ownStanding = standings.find((team) => team.classCode === profile.classCode)
  const [active, setActive] = useState<NavLabel>('Vandaag')
  const [moreSection, setMoreSection] = useState<MoreSectionId>('notifications')
  const [largeText, setLargeText] = useState(false)
  const [widescreenDashboard, setWidescreenDashboard] = useState(true)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [simulatedDate, setSimulatedDate] = useState<Date | null>(null)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshComplete, setRefreshComplete] = useState(false)
  const [electricXSequence, setElectricXSequence] = useState(0)
  const [electricXVisible, setElectricXVisible] = useState(false)
  const [weatherSelection, setWeatherSelection] = useState<ProgrammeWeatherSelection | null>(null)
  const pullStartYRef = useRef<number | null>(null)
  const pullDistanceRef = useRef(0)
  const refreshResetTimerRef = useRef<number | null>(null)
  const electricXHideTimerRef = useRef<number | null>(null)
  const effectiveTime = simulatedDate ?? currentTime
  const homeProgramme = getHomeProgramme(effectiveTime, currentProgrammeDays)
  const isWidescreenActive = widescreenDashboard && active === 'Meer' && moreSection === 'import' && profile.profileType === 'organizer'

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    if (refreshResetTimerRef.current !== null) window.clearTimeout(refreshResetTimerRef.current)
  }, [])

  function triggerEnterX() {
    if (electricXHideTimerRef.current !== null) window.clearTimeout(electricXHideTimerRef.current)
    setElectricXSequence((sequence) => sequence + 1)
    setElectricXVisible(true)
    electricXHideTimerRef.current = window.setTimeout(() => {
      setElectricXVisible(false)
      electricXHideTimerRef.current = null
    }, 1_700)
  }

  useEffect(() => {
    const interval = window.setInterval(triggerEnterX, 180_000)
    return () => {
      window.clearInterval(interval)
      if (electricXHideTimerRef.current !== null) window.clearTimeout(electricXHideTimerRef.current)
    }
  }, [])

  function updatePullDistance(distance: number) {
    pullDistanceRef.current = distance
    setPullDistance(distance)
  }

  function handlePullStart(event: TouchEvent<HTMLElement>) {
    if (event.currentTarget.scrollTop > 0 || isRefreshing) return
    pullStartYRef.current = event.touches[0]?.clientY ?? null
  }

  function handlePullMove(event: TouchEvent<HTMLElement>) {
    if (pullStartYRef.current === null || isRefreshing || event.currentTarget.scrollTop > 0) return
    const currentY = event.touches[0]?.clientY
    if (currentY === undefined) return
    const distance = currentY - pullStartYRef.current
    updatePullDistance(distance > 0 ? Math.min(82, distance * 0.46) : 0)
  }

  async function refreshAppData() {
    if (isRefreshing) return
    setIsRefreshing(true)
    setRefreshComplete(false)
    updatePullDistance(48)

    const minimumAnimation = new Promise<void>((resolve) => window.setTimeout(resolve, 700))
    await Promise.allSettled([
      masterContent.refresh(true),
      notificationInbox.refresh(true),
      minimumAnimation,
    ])

    setIsRefreshing(false)
    setRefreshComplete(true)
    updatePullDistance(48)
    refreshResetTimerRef.current = window.setTimeout(() => {
      setRefreshComplete(false)
      updatePullDistance(0)
      refreshResetTimerRef.current = null
    }, 750)
  }

  function handlePullEnd() {
    pullStartYRef.current = null
    if (pullDistanceRef.current >= 58) {
      void refreshAppData()
      return
    }
    updatePullDistance(0)
  }

  function openNotifications() {
    setMoreSection('notifications')
    setActive('Meer')
    void notificationInbox.refresh()
  }

  return (
    <div className={`app-shell enter-x-shell${largeText ? ' large-text-mode' : ''}${isWidescreenActive ? ' widescreen-dashboard' : ''}`}>
      <div className="map-texture" aria-hidden="true" />
      {electricXVisible && (
        <div key={electricXSequence} className="enter-electric-stage" aria-hidden="true">
          <img
            className="electric-image electric-image-left"
            src={`${import.meta.env.BASE_URL}enter-the-x-electric.webp`}
            alt=""
            decoding="async"
          />
          <img
            className="electric-image electric-image-right"
            src={`${import.meta.env.BASE_URL}enter-the-x-electric.webp`}
            alt=""
            decoding="async"
          />
          <span className="electric-image-collision" />
          <img
            className="electric-image electric-image-complete"
            src={`${import.meta.env.BASE_URL}enter-the-x-electric.webp`}
            alt=""
            decoding="async"
          />
        </div>
      )}
      <header className="topbar">
        <AnimatedBrandLogo firstName={profile.firstName} onTriggerEnterX={triggerEnterX} />
        <div className="identity-row">
          <div className="identity">
            {profile.profileType === 'interested_teacher'
              ? <UserRound aria-hidden="true" />
              : <CountryFlagIcon country={profile.country} size={24} />}
            <span>{profile.classCode ? `${profile.classCode} · ${profile.country}` : profile.country}</span>
          </div>
          <button
            className="icon-button notification"
            aria-label={notificationInbox.unreadCount > 0
              ? `${notificationInbox.unreadCount} nieuwe meldingen openen`
              : 'Meldingen openen'}
            onClick={openNotifications}
          >
            <Bell aria-hidden="true" />
            {notificationInbox.unreadCount > 0 && <span className="notification-dot" />}
          </button>
        </div>
      </header>

      <main
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
        onTouchCancel={handlePullEnd}
      >
        <div
          className={`pull-refresh-indicator${pullDistance > 8 ? ' is-visible' : ''}${isRefreshing ? ' is-refreshing' : ''}${refreshComplete ? ' is-complete' : ''}`}
          style={{ height: `${pullDistance}px` }}
          role="status"
          aria-live="polite"
          aria-hidden={pullDistance <= 8 && !isRefreshing && !refreshComplete}
        >
          <RefreshCw aria-hidden="true" />
          <span>
            {isRefreshing
              ? 'Vernieuwen...'
              : refreshComplete
                ? 'Helemaal bijgewerkt'
                : pullDistance >= 58
                  ? 'Laat los om te vernieuwen'
                  : 'Trek omlaag om te vernieuwen'}
          </span>
        </div>
        {active === 'Vandaag' && (
          <>
            <section className="welcome" aria-labelledby="welcome-title">
              <p className="eyebrow enter-day-heading">{enterDayIdentity[homeProgramme.day.id].label}</p>
              <p className="welcome-date">{homeProgramme.day.id} {homeProgramme.day.date}</p>
              <h1 id="welcome-title">{homeProgramme.greeting}, {profile.firstName}</h1>
              <p className="welcome-copy">Alles wat je vandaag nodig hebt, staat hier voor je klaar.</p>
            </section>

            <div className="time-travel-bar" aria-label="Tijdsimulatie voor testen">
              <div className="time-travel-label">
                <span>Simuleer tijd:</span>
                {simulatedDate && <small>({simulatedDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })})</small>}
              </div>
              <div className="time-travel-presets">
                <button
                  type="button"
                  className={presetId === '13:15' ? 'active' : ''}
                  onClick={() => {
                    setPresetId('13:15')
                    setSimulatedDate(new Date('2026-08-25T13:15:00+02:00'))
                  }}
                >
                  Di 13:15
                </button>
                <button
                  type="button"
                  className={presetId === '14:45' ? 'active' : ''}
                  onClick={() => {
                    setPresetId('14:45')
                    setSimulatedDate(new Date('2026-08-25T14:45:00+02:00'))
                  }}
                >
                  Di 14:45
                </button>
                <button
                  type="button"
                  className={presetId === '16:00' ? 'active' : ''}
                  onClick={() => {
                    setPresetId('16:00')
                    setSimulatedDate(new Date('2026-08-25T16:00:00+02:00'))
                  }}
                >
                  Di 16:00
                </button>
                <button
                  type="button"
                  className={presetId === '18:00' ? 'active' : ''}
                  onClick={() => {
                    setPresetId('18:00')
                    setSimulatedDate(new Date('2026-08-25T18:00:00+02:00'))
                  }}
                >
                  Di 18:00
                </button>
                <button
                  type="button"
                  className={presetId === 'wo-18:00' ? 'active' : ''}
                  onClick={() => {
                    setPresetId('wo-18:00' as any)
                    setSimulatedDate(new Date('2026-08-26T18:00:00+02:00'))
                  }}
                >
                  Wo 18:00
                </button>
                <button
                  type="button"
                  className={presetId === 'do-19:30' ? 'active' : ''}
                  onClick={() => {
                    setPresetId('do-19:30' as any)
                    setSimulatedDate(new Date('2026-08-27T19:30:00+02:00'))
                  }}
                >
                  Do 19:30 🏆
                </button>
                <button
                  type="button"
                  className={presetId === null ? 'active real' : ''}
                  onClick={() => {
                    setPresetId(null)
                    setSimulatedDate(null)
                  }}
                >
                  ⏱️ Live tijd
                </button>
              </div>
            </div>

            <section className="next-card" aria-labelledby="next-title">
              <div className={`card-kicker ${homeProgramme.isCurrentlyActive ? 'is-active' : homeProgramme.introweekCompleted ? 'is-completed' : homeProgramme.nextDay ? 'is-next-day' : ''}`}>
                {homeProgramme.isCurrentlyActive ? (
                  <>
                    <span className="live-pulse-dot" /> NU BEZIG
                  </>
                ) : homeProgramme.introweekCompleted ? (
                  <>
                    🏆 INTROWEEK COMPLEET
                  </>
                ) : homeProgramme.nextDay ? (
                  <>
                    <span>★</span> VOORUITBLIK · {homeProgramme.nextDay.shortLabel.toUpperCase()}
                  </>
                ) : (
                  <>
                    <span>★</span> {homeProgramme.currentIndex === -1 ? 'EERSTE ACTIVITEIT' : 'VOLGENDE'} · {homeProgramme.day.shortLabel.toUpperCase()}
                  </>
                )}
              </div>

              {homeProgramme.introweekCompleted ? (
                <div className="completed-hero-content">
                  <h2 id="next-title">Bedankt voor een fantastische Introweek!</h2>
                  <p className="completed-card-copy">Alle activiteiten zijn afgerond en het eindklassement van de Landenstrijd is bekend.</p>
                  <button className="primary-button" onClick={() => setActive('Strijd')}>
                    <Trophy aria-hidden="true" />
                    <span>Bekijk het eindklassement</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="next-card-title-row">
                    <h2 id="next-title">{homeProgramme.activeItem.title}</h2>
                    <ProgrammeWeatherButton
                      day={homeProgramme.nextDay ?? homeProgramme.day}
                      item={homeProgramme.activeItem}
                      forecast={weatherForecast}
                      onOpen={setWeatherSelection}
                    />
                  </div>
                  <div className="next-details">
                    <div className="detail-row">
                      <Clock3 aria-hidden="true" />
                      <strong>
                        {`${homeProgramme.nextDay ? homeProgramme.nextDay.shortLabel : homeProgramme.day.shortLabel} om ${homeProgramme.activeItem.time}`}
                      </strong>
                    </div>
                    {homeProgramme.activeItem.location && <div className="detail-row"><MapPin aria-hidden="true" /><span>{homeProgramme.activeItem.location}</span></div>}
                    <div className="detail-row countdown">
                      <span>
                        {homeProgramme.status}
                      </span>
                    </div>
                  </div>
                  {homeProgramme.activeItem.routeUrl && (
                    <a className="primary-button" href={homeProgramme.activeItem.routeUrl} target="_blank" rel="noreferrer">
                      <span>Open route</span><ChevronRight aria-hidden="true" />
                    </a>
                  )}
                </>
              )}
            </section>

            <section className="timeline-section" aria-labelledby="today-title">
              <div className="section-heading">
                <h2 id="today-title">Vandaag</h2>
                <span>Jouw programma</span>
              </div>
              <ol className="timeline">
                {homeProgramme.day.items.map((item, index) => {
                  const isCurrent = index === homeProgramme.currentIndex
                  const isNext = index === homeProgramme.nextIndex && !homeProgramme.isCurrentlyActive && !homeProgramme.finished
                  const isPast = homeProgramme.finished
                    ? true
                    : index < (homeProgramme.currentIndex >= 0 ? homeProgramme.currentIndex : homeProgramme.nextIndex) && !isCurrent

                  return (
                    <li key={`${item.time}-${item.title}`} className={isCurrent ? 'current' : isNext ? 'next' : isPast ? 'past' : 'later'}>
                      <span className="timeline-dot" aria-hidden="true" />
                      <div className="timeline-card">
                        <time>{item.time}</time>
                        <div className="timeline-body">
                          <strong>{item.title}</strong>
                          {item.location && <small>{item.location}</small>}
                        </div>
                        <ProgrammeWeatherButton day={homeProgramme.day} item={item} forecast={weatherForecast} onOpen={setWeatherSelection} />
                        {(isCurrent || isNext) && (
                          <div className="timeline-badge-cell">
                            {isCurrent && <span className="now-active-pill"><i className="live-pulse-dot" /> Nu bezig</span>}
                            {isNext && <span className="next-up-pill">Volgende</span>}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>

            <button className="standings-card" onClick={() => setActive('Strijd')}>
              <div className="standings-flag-wrapper waving-flag" aria-hidden="true">
                <CountryFlagIcon country={profile.country} size={48} />
                <div className="flag-wave-sheen" />
              </div>
              <div className="standings-copy">
                <div className="standings-kicker">
                  <span>Landenstrijd · {profile.classCode}</span>
                </div>
                <strong>Samen voor {profile.country}</strong>
                <p>Bekijk het klassement en scoor punten</p>
              </div>
              <span className="standings-action">
                <span>Bekijk</span>
                <ChevronRight aria-hidden="true" />
              </span>
            </button>
          </>
        )}

        {active === 'Programma' && <ProgrammeView programmeDays={currentProgrammeDays} weatherForecast={weatherForecast} onOpenWeather={setWeatherSelection} />}

        {active === 'Kaart' && <MapView routeDays={currentRouteDays} />}

        {active === 'Strijd' && <CompetitionView onNavigate={(destination, section) => {
          if (section) setMoreSection(section)
          setActive(destination)
          if (section === 'notifications') void notificationInbox.refresh()
        }} />}

        {active === 'Meer' && (
          <MoreView
            selected={moreSection}
            onSelect={setMoreSection}
            notifications={notificationInbox.notifications}
            unreadCount={notificationInbox.unreadCount}
            notificationsLoading={notificationInbox.loading}
            notificationsError={notificationInbox.error}
            onRefreshNotifications={() => { void notificationInbox.refresh(true) }}
            onMarkNotificationRead={(notificationId) => { void notificationInbox.markRead(notificationId) }}
            onMarkAllNotificationsRead={() => { void notificationInbox.markAllRead() }}
            content={masterContent.content}
            contentVersion={masterContent.version}
            onContentUpdated={() => { void masterContent.refresh(true) }}
            largeText={largeText}
            onToggleLargeText={() => setLargeText((v) => !v)}
            isWidescreen={widescreenDashboard}
            onToggleWidescreen={() => setWidescreenDashboard((v) => !v)}
          />
        )}
      </main>

      {weatherSelection && <ProgrammeWeatherModal selection={weatherSelection} onClose={() => setWeatherSelection(null)} />}

      <nav className="bottom-nav" aria-label="Hoofdnavigatie">
        {navItems.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={active === label ? 'active' : ''}
            onClick={() => setActive(label)}
            aria-current={active === label ? 'page' : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
