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

const routes = {
  inholland: 'https://maps.app.goo.gl/c28qCsxH5BxArCxX9',
  deDuif: 'https://maps.app.goo.gl/TzDtQjuwy45XLf9S7',
  sportcentrum: 'https://maps.app.goo.gl/X5UauhuGxNfmSAwq6',
  ndsm: 'https://maps.app.goo.gl/NWYgPZzJN3uzpzHV6',
  entr: 'https://maps.app.goo.gl/NEV7Ea8vdJf61XJk9',
  nieuwmarkt: 'https://maps.app.goo.gl/LAsJKx49jRdsE8s18',
  kokomo: 'https://maps.app.goo.gl/Ud1m2dKt5kXKRsCu6',
}

export const today: TimelineItem[] = [
  { time: '11:45', title: 'Het Amsterdams Geluid', location: 'De Duif', state: 'next' },
  { time: '13:30', title: 'Lunch & verplaatsing', state: 'later' },
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
      { time: '15:00', title: 'Openingsceremonie', category: 'Gezamenlijk', location: 'Balkon tweede verdieping' },
      { time: '16:00', title: 'Vlaggenparade', category: 'Landenstrijd', location: 'Vertrek vanaf Inholland', routeUrl: routes.inholland },
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
      { time: '13:30', title: 'Lunch & verplaatsing', category: 'Eigen tijd', location: 'Amsterdam' },
      { time: '14:30', title: 'Sports Experiences', category: 'Experience', location: 'Sportcentrum De Pijp', routeUrl: routes.sportcentrum },
      { time: '16:00', title: 'Einde programma & naborrel', category: 'Vrijblijvend', location: 'Locatie volgt' },
    ],
  },
  {
    id: 'donderdag',
    shortLabel: 'Do 27',
    date: '27 augustus',
    title: 'City Game & finale',
    summary: 'Verzamel de laatste punten, beleef BLEND en vier de winnaar tijdens de eindborrel.',
    items: [
      { time: '10:45', title: 'Verzamelen bij je PO’er', category: 'Start', location: 'NDSM-Kade 4', routeUrl: routes.ndsm },
      { time: '11:00', title: 'Cultural Experiences', category: 'City Game', location: 'NDSM-werf', routeUrl: routes.ndsm },
      { time: '12:30', title: 'VR Experience', category: 'Experience', location: 'ENTR', routeUrl: routes.entr },
      { time: '14:00', title: 'Food, Retail & Hospitality', category: 'City Game', location: 'Nieuwmarkt', routeUrl: routes.nieuwmarkt },
      { time: '15:00', title: 'BLEND-festival', category: 'Festival', location: 'Inholland Amsterdam', routeUrl: routes.inholland },
      { time: '18:00', title: 'Eindborrel & prijsuitreiking', category: 'Finale', location: 'Kokomo Amsterdam', routeUrl: routes.kokomo },
    ],
  },
]

export const mapUrl = routes.deDuif
