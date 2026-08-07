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

export type TeamScoreHistory = {
  id: string
  title: string
  points: number
  category: 'POV-foto' | 'Experience' | 'City Game' | 'Bonus' | 'Vlaggenparade'
  awardedAt: string
}

export type Standing = {
  rank: number
  classCode: string
  country: string
  flag: string
  points: number
  isOwn?: boolean
  history?: TeamScoreHistory[]
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

export const defaultScoreHistories: Record<string, TeamScoreHistory[]> = {
  LM1C: [
    { id: 'h-c1', title: 'City Game Challenge NDSM', points: 65, category: 'City Game', awardedAt: 'Donderdag 14:15' },
    { id: 'h-c2', title: 'Foto-opdracht NDSM-werf (1e prijs)', points: 55, category: 'POV-foto', awardedAt: 'Donderdag 12:30' },
    { id: 'h-c3', title: 'Experience Het Amsterdams Geluid', points: 45, category: 'Experience', awardedAt: 'Woensdag 15:00' },
    { id: 'h-c4', title: 'Vlaggenparade Sluisbuurt', points: 40, category: 'Vlaggenparade', awardedAt: 'Dinsdag 16:30' },
  ],
  LM1A: [
    { id: 'h-a1', title: 'Cultural Experiences NDSM', points: 55, category: 'City Game', awardedAt: 'Donderdag 13:45' },
    { id: 'h-a2', title: 'Sports Experiences De Pijp', points: 45, category: 'Experience', awardedAt: 'Woensdag 15:30' },
    { id: 'h-a3', title: 'Ontdek de Sluisbuurt klasfoto', points: 45, category: 'POV-foto', awardedAt: 'Dinsdag 15:15' },
    { id: 'h-a4', title: 'Bonus: Beste teamsfeer', points: 35, category: 'Bonus', awardedAt: 'Dinsdag 17:00' },
  ],
  LM1F: [
    { id: 'h-f1', title: 'VR Experience ENTR', points: 50, category: 'Experience', awardedAt: 'Donderdag 13:00' },
    { id: 'h-f2', title: 'Creatiefste POV-foto De Duif', points: 42, category: 'POV-foto', awardedAt: 'Woensdag 14:00' },
    { id: 'h-f3', title: 'Vlaggenparade Enthousiasme', points: 45, category: 'Vlaggenparade', awardedAt: 'Dinsdag 16:20' },
    { id: 'h-f4', title: 'Welkomstopdracht Sluisbuurt', points: 35, category: 'Bonus', awardedAt: 'Dinsdag 14:00' },
  ],
  LM1B: [
    { id: 'h-b1', title: 'Food & Hospitality Challenge', points: 45, category: 'City Game', awardedAt: 'Donderdag 14:30' },
    { id: 'h-b2', title: 'Sports Experiences Winnaar', points: 45, category: 'Experience', awardedAt: 'Woensdag 15:45' },
    { id: 'h-b3', title: 'Sluisbuurt Foto-opdracht', points: 40, category: 'POV-foto', awardedAt: 'Dinsdag 15:00' },
    { id: 'h-b4', title: 'Landenstrijd Baggerbeest Bonus', points: 30, category: 'Bonus', awardedAt: 'Dinsdag 17:30' },
  ],
  LM1G: [
    { id: 'h-g1', title: 'City Game Nieuwmarkt', points: 44, category: 'City Game', awardedAt: 'Donderdag 14:10' },
    { id: 'h-g2', title: 'Experience De Duif', points: 40, category: 'Experience', awardedAt: 'Woensdag 13:15' },
    { id: 'h-g3', title: 'Vlaggenparade Presentation', points: 35, category: 'Vlaggenparade', awardedAt: 'Dinsdag 16:15' },
    { id: 'h-g4', title: 'POV Foto Inholland', points: 30, category: 'POV-foto', awardedAt: 'Dinsdag 14:30' },
  ],
  LM1D: [
    { id: 'h-d1', title: 'City Game Challenge', points: 40, category: 'City Game', awardedAt: 'Donderdag 13:30' },
    { id: 'h-d2', title: 'Sports Experiences', points: 38, category: 'Experience', awardedAt: 'Woensdag 15:10' },
    { id: 'h-d3', title: 'Ontdek de Sluisbuurt', points: 35, category: 'POV-foto', awardedAt: 'Dinsdag 14:45' },
    { id: 'h-d4', title: 'Sfeerbonus Baggerbeest', points: 25, category: 'Bonus', awardedAt: 'Dinsdag 17:15' },
  ],
  LM1E: [
    { id: 'h-e1', title: 'Cultural Experiences', points: 40, category: 'City Game', awardedAt: 'Donderdag 12:45' },
    { id: 'h-e2', title: 'Amsterdams Geluid Quiz', points: 34, category: 'Experience', awardedAt: 'Woensdag 12:50' },
    { id: 'h-e3', title: 'Vlaggenparade', points: 30, category: 'Vlaggenparade', awardedAt: 'Dinsdag 16:10' },
    { id: 'h-e4', title: 'POV Klasfoto', points: 20, category: 'POV-foto', awardedAt: 'Dinsdag 14:15' },
  ],
  LM1H: [
    { id: 'h-h1', title: 'City Game Start', points: 30, category: 'City Game', awardedAt: 'Donderdag 11:30' },
    { id: 'h-h2', title: 'Sports Experiences', points: 30, category: 'Experience', awardedAt: 'Woensdag 15:00' },
    { id: 'h-h3', title: 'Ontdek de Sluisbuurt', points: 30, category: 'POV-foto', awardedAt: 'Dinsdag 14:40' },
    { id: 'h-h4', title: 'Bonuspunten deelname', points: 20, category: 'Bonus', awardedAt: 'Dinsdag 16:00' },
  ],
}

export const standings: Standing[] = [
  { rank: 1, classCode: 'LM1C', country: 'Canada', flag: '🇨🇦', points: 205, history: defaultScoreHistories.LM1C },
  { rank: 2, classCode: 'LM1A', country: 'Australië', flag: '🇦🇺', points: 180, isOwn: true, history: defaultScoreHistories.LM1A },
  { rank: 3, classCode: 'LM1F', country: 'Frankrijk', flag: '🇫🇷', points: 172, history: defaultScoreHistories.LM1F },
  { rank: 4, classCode: 'LM1B', country: 'Brazilië', flag: '🇧🇷', points: 160, history: defaultScoreHistories.LM1B },
  { rank: 5, classCode: 'LM1G', country: 'Griekenland', flag: '🇬🇷', points: 149, history: defaultScoreHistories.LM1G },
  { rank: 6, classCode: 'LM1D', country: 'Denemarken', flag: '🇩🇰', points: 138, history: defaultScoreHistories.LM1D },
  { rank: 7, classCode: 'LM1E', country: 'Estland', flag: '🇪🇪', points: 124, history: defaultScoreHistories.LM1E },
  { rank: 8, classCode: 'LM1H', country: 'Hongarije', flag: '🇭🇺', points: 110, history: defaultScoreHistories.LM1H },
]

export const mapUrl = routes.deDuif
