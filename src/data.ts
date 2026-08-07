export type TimelineItem = {
  time: string
  title: string
  location?: string
  state: 'next' | 'later'
}

export type ProgrammeItem = {
  time: string
  title: string
  category: string
  location?: string
  routeUrl?: string
}

export type ProgrammeDay = {
  id: 'dinsdag' | 'woensdag' | 'donderdag'
  shortLabel: string
  date: string
  title: string
  summary: string
  items: ProgrammeItem[]
}

export type RouteStop = {
  number: number
  time: string
  title: string
  address: string
  routeUrl: string
  latitude: number
  longitude: number
}

export type RouteDay = {
  id: ProgrammeDay['id']
  shortLabel: string
  label: string
  stops: RouteStop[]
}

export function getDefaultIntroDayId(referenceDate = new Date()): ProgrammeDay['id'] {
  const dateParts = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceDate)
  const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((item) => item.type === type)?.value ?? ''
  const amsterdamDate = `${part('year')}-${part('month')}-${part('day')}`

  if (amsterdamDate <= '2026-08-25') return 'dinsdag'
  if (amsterdamDate === '2026-08-26') return 'woensdag'
  return 'donderdag'
}

export type Standing = {
  rank: number
  classCode: string
  country: string
  flag: string
  points: number
  isOwn?: boolean
}

const routes = {
  inholland: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4',
  deDuif: 'https://maps.app.goo.gl/TzDtQjuwy45XLf9S7',
  sportcentrum: 'https://maps.app.goo.gl/X5UauhuGxNfmSAwq6',
  ndsm: 'https://maps.app.goo.gl/NWYgPZzJN3uzpzHV6',
  entr: 'https://maps.app.goo.gl/NEV7Ea8vdJf61XJk9',
  nieuwmarkt: 'https://maps.app.goo.gl/LAsJKx49jRdsE8s18',
  kokomo: 'https://maps.app.goo.gl/Ud1m2dKt5kXKRsCu6',
}

export const today: TimelineItem[] = [
  { time: '11:45', title: 'Het Amsterdams Geluid', location: 'De Duif', state: 'next' },
  { time: '13:30', title: 'Lunch & verplaatsing', location: 'Inholland Amsterdam', state: 'later' },
  { time: '14:30', title: 'Sports Experiences', location: 'Sportcentrum De Pijp', state: 'later' },
]

export const programmeDays: ProgrammeDay[] = [
  {
    id: 'dinsdag',
    shortLabel: 'Di 25',
    date: '25 augustus',
    title: 'Welkom & kennismaken',
    summary: 'Ontdek je klas, de opleiding en de Sluisbuurt. We sluiten samen af bij Baggerbeest.',
    items: [
      { time: '13:00', title: 'Ontvangst eerstejaars', category: 'Welkom', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '14:30', title: 'Ontdek de Sluisbuurt', category: 'Foto-opdracht', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '15:00', title: 'Openingsceremonie', category: 'Gezamenlijk', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '16:00', title: 'Vlaggenparade', category: 'Landenstrijd', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '16:15', title: 'Goodiebags, spellen & borrel', category: 'Afsluiting', location: 'Baggerbeest' },
    ],
  },
  {
    id: 'woensdag',
    shortLabel: 'Wo 26',
    date: '26 augustus',
    title: 'Experiences door Amsterdam',
    summary: 'LM1A bezoekt vandaag twee belevingsgebieden. Tussendoor reis en lunch je zelfstandig.',
    items: [
      { time: '11:45', title: 'Het Amsterdams Geluid', category: 'Experience', location: 'De Duif', routeUrl: routes.deDuif },
      { time: '13:30', title: 'Lunch & verplaatsing', category: 'Eigen tijd', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '14:30', title: 'Sports Experiences', category: 'Experience', location: 'Sportcentrum De Pijp', routeUrl: routes.sportcentrum },
      { time: '16:00', title: 'Einde programma & naborrel', category: 'Vrijblijvend', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
    ],
  },
  {
    id: 'donderdag',
    shortLabel: 'Do 27',
    date: '27 augustus',
    title: 'City Game & finale',
    summary: 'Verzamel de laatste punten, beleef BLEND en vier de winnaar tijdens de eindborrel.',
    items: [
      { time: '10:45', title: 'Verzamelen bij je PO’er', category: 'Start', location: 'NDSM-werf', routeUrl: routes.ndsm },
      { time: '11:00', title: 'Cultural Experiences', category: 'City Game', location: 'NDSM-werf', routeUrl: routes.ndsm },
      { time: '12:30', title: 'VR Experience', category: 'Experience', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '14:00', title: 'Food, Retail & Hospitality', category: 'City Game', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '15:00', title: 'BLEND-festival', category: 'Festival', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '18:00', title: 'Eindborrel & prijsuitreiking', category: 'Finale', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
    ],
  },
]

export const routeDays: RouteDay[] = [
  {
    id: 'dinsdag',
    shortLabel: 'Di 25',
    label: 'Welkom & Baggerbeest',
    stops: [
      { number: 1, time: '13:00', title: 'Inholland Amsterdam', address: 'Pina Bauschplein 4', routeUrl: routes.inholland, latitude: 52.3702, longitude: 4.9530 },
      { number: 2, time: '16:15', title: 'Baggerbeest', address: 'Eef Kamerbeekstraat 1006', routeUrl: 'https://maps.google.com/?q=Baggerbeest+Amsterdam', latitude: 52.3708, longitude: 4.9602 },
    ],
  },
  {
    id: 'woensdag',
    shortLabel: 'Wo 26',
    label: 'Experiences door Amsterdam',
    stops: [
      { number: 1, time: '11:45', title: 'De Duif', address: 'Prinsengracht 756', routeUrl: routes.deDuif, latitude: 52.3614502, longitude: 4.8966973 },
      { number: 2, time: '14:30', title: 'Sportcentrum De Pijp', address: 'Lizzy Ansinghstraat 88', routeUrl: routes.sportcentrum, latitude: 52.3496503, longitude: 4.8937569 },
    ],
  },
  {
    id: 'donderdag',
    shortLabel: 'Do 27',
    label: 'City Game & finale',
    stops: [
      { number: 1, time: '10:45', title: 'NDSM-werf', address: 'NDSM-Plein 1', routeUrl: routes.ndsm, latitude: 52.4005, longitude: 4.8925 },
      { number: 2, time: '15:00', title: 'Inholland Amsterdam', address: 'Pina Bauschplein 4', routeUrl: routes.inholland, latitude: 52.3702, longitude: 4.9530 },
    ],
  },
]

export const standings: Standing[] = [
  { rank: 1, classCode: 'LM1C', country: 'Canada', flag: '🇨🇦', points: 205 },
  { rank: 2, classCode: 'LM1A', country: 'Australië', flag: '🇦🇺', points: 180, isOwn: true },
  { rank: 3, classCode: 'LM1F', country: 'Frankrijk', flag: '🇫🇷', points: 172 },
  { rank: 4, classCode: 'LM1B', country: 'Brazilië', flag: '🇧🇷', points: 160 },
  { rank: 5, classCode: 'LM1G', country: 'Griekenland', flag: '🇬🇷', points: 149 },
  { rank: 6, classCode: 'LM1D', country: 'Denemarken', flag: '🇩🇰', points: 138 },
  { rank: 7, classCode: 'LM1E', country: 'Estland', flag: '🇪🇪', points: 124 },
  { rank: 8, classCode: 'LM1H', country: 'Hongarije', flag: '🇭🇺', points: 110 },
]

export const mapUrl = routes.deDuif
