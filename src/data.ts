export type TimelineItem = {
  time: string
  title: string
  location?: string
  state: 'next' | 'later'
}

export const today: TimelineItem[] = [
  { time: '11:45', title: 'Het Amsterdams Geluid', location: 'De Duif', state: 'next' },
  { time: '13:30', title: 'Lunch & verplaatsing', state: 'later' },
  { time: '14:30', title: 'Sports Experiences', location: 'Sportcentrum De Pijp', state: 'later' },
]

export const mapUrl = 'https://maps.app.goo.gl/TzDtQjuwy45XLf9S7'
