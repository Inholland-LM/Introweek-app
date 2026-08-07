export type ScheduledMessage = {
  id: string
  scheduledAt: string
  title: string
  body: string
  classCodes?: string[]
}

const allClasses = ['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H']

export const scheduledMessages: ScheduledMessage[] = [
  {
    id: 'di-sluisbuurt-start',
    scheduledAt: '2026-08-25T14:30:00+02:00',
    title: 'Ontdek de Sluisbuurt!',
    body: 'Ga na de uitleg in groepjes op pad. Rond de foto-opdracht af en verzamel om 14:55 uur weer bij je PO’er op het balkon van de tweede verdieping.',
  },
  {
    id: 'di-openingsceremonie-vijf-minuten',
    scheduledAt: '2026-08-25T14:55:00+02:00',
    title: 'Nog 5 minuten!',
    body: 'Rond jullie foto-opdracht af en ga naar het balkon op de tweede verdieping. Om 15:00 uur begint de openingsceremonie.',
  },
  {
    id: 'di-pov-reminder',
    scheduledAt: '2026-08-25T17:30:00+02:00',
    title: 'Reminder POV!',
    body: 'Vergeet de POV-foto’s niet. Misschien wint jullie klas punten met de leukste of gezelligste inzending.',
  },
  {
    id: 'wo-start-de-duif',
    scheduledAt: '2026-08-26T10:45:00+02:00',
    title: 'Goedemorgen!',
    body: 'Over een uur begint jullie eerste experience in De Duif, Prinsengracht 756. Zorg dat je op tijd bent.',
    classCodes: ['LM1A', 'LM1B', 'LM1C', 'LM1D'],
  },
  {
    id: 'wo-start-sportcentrum',
    scheduledAt: '2026-08-26T10:45:00+02:00',
    title: 'Goedemorgen!',
    body: 'Over een uur begint jullie eerste experience in Sportcentrum De Pijp, Lizzy Ansinghstraat 88. Zorg dat je op tijd bent.',
    classCodes: ['LM1E', 'LM1F', 'LM1G', 'LM1H'],
  },
  {
    id: 'wo-pov-ochtend',
    scheduledAt: '2026-08-26T11:55:00+02:00',
    title: 'Reminder POV!',
    body: 'Vergeet de categorieën van de POV-foto’s niet.',
  },
  {
    id: 'wo-roulatie',
    scheduledAt: '2026-08-26T13:30:00+02:00',
    title: 'Experience roulatie',
    body: 'De eerste experience zit erop. Tank even bij en zorg dat je uiterlijk om 14:30 uur klaarstaat bij jullie tweede experience.',
  },
  {
    id: 'wo-naar-sportcentrum',
    scheduledAt: '2026-08-26T14:10:00+02:00',
    title: 'Nog 20 minuten!',
    body: 'Rond jullie lunch af en ga naar Sportcentrum De Pijp, Lizzy Ansinghstraat 88. Om 14:30 uur beginnen we.',
    classCodes: ['LM1A', 'LM1B', 'LM1C', 'LM1D'],
  },
  {
    id: 'wo-naar-de-duif',
    scheduledAt: '2026-08-26T14:10:00+02:00',
    title: 'Nog 20 minuten!',
    body: 'Rond jullie lunch af en ga naar De Duif, Prinsengracht 756. Om 14:30 uur beginnen we.',
    classCodes: ['LM1E', 'LM1F', 'LM1G', 'LM1H'],
  },
  {
    id: 'wo-pov-middag',
    scheduledAt: '2026-08-26T14:25:00+02:00',
    title: 'Reminder POV!',
    body: 'Tijd voor punten en nieuwe POV-foto’s.',
  },
  {
    id: 'wo-naborrel',
    scheduledAt: '2026-08-26T16:05:00+02:00',
    title: 'Blijf gezellig naborrelen!',
    body: 'Het programma zit erop, maar de gezelligheid hoeft niet te stoppen. Zoek je klasgenoten, PO’er en buddy’s op en maak gebruik van de kortingen.',
  },
  {
    id: 'do-start-ndsm',
    scheduledAt: '2026-08-27T09:45:00+02:00',
    title: 'Goedemorgen!',
    body: 'Over een uur begint jullie City Game op de NDSM-werf. Verzamel bij NDSM-Kade 4 en zorg dat je op tijd bent.',
    classCodes: ['LM1A', 'LM1B', 'LM1C'],
  },
  {
    id: 'do-start-entr',
    scheduledAt: '2026-08-27T09:45:00+02:00',
    title: 'Goedemorgen!',
    body: 'Over een uur begint jullie experience bij ENTR, Oosterdokskade 131b. Op tijd zijn is hier extra belangrijk.',
    classCodes: ['LM1D', 'LM1E', 'LM1F'],
  },
  {
    id: 'do-start-nieuwmarkt',
    scheduledAt: '2026-08-27T09:45:00+02:00',
    title: 'Goedemorgen!',
    body: 'Over een uur begint jullie City Game op de Nieuwmarkt. Verzamel bij Nieuwmarkt 4 en zorg dat je op tijd bent.',
    classCodes: ['LM1G', 'LM1H'],
  },
  {
    id: 'do-pov-start',
    scheduledAt: '2026-08-27T11:00:00+02:00',
    title: 'Veel plezier!',
    body: 'Leg de leukste momenten van de introweek vast via de POV-app en verdien extra punten voor jullie land.',
  },
  {
    id: 'do-wissel-naar-entr',
    scheduledAt: '2026-08-27T12:00:00+02:00',
    title: 'Wissel!',
    body: 'Rond jullie opdracht af en ga direct naar ENTR, Oosterdokskade 131b. Op tijd zijn is hier extra belangrijk.',
    classCodes: ['LM1A', 'LM1B', 'LM1C'],
  },
  {
    id: 'do-wissel-naar-nieuwmarkt',
    scheduledAt: '2026-08-27T12:00:00+02:00',
    title: 'Wissel!',
    body: 'Rond jullie opdracht af en ga naar Nieuwmarkt 4. Vergeet onderweg de algemene opdrachten niet.',
    classCodes: ['LM1D', 'LM1E', 'LM1F'],
  },
  {
    id: 'do-wissel-naar-ndsm',
    scheduledAt: '2026-08-27T12:00:00+02:00',
    title: 'Wissel!',
    body: 'Rond jullie opdracht af en ga naar NDSM-Kade 4. Vergeet onderweg de algemene opdrachten niet.',
    classCodes: ['LM1G', 'LM1H'],
  },
  {
    id: 'do-tweede-ronde',
    scheduledAt: '2026-08-27T12:30:00+02:00',
    title: 'Gaan we weer!',
    body: 'Hopelijk zijn jullie op locatie en alweer punten aan het verzamelen. Geef alles en pak de QR-codeopdrachten slim mee.',
  },
  {
    id: 'do-tweede-wissel-naar-nieuwmarkt',
    scheduledAt: '2026-08-27T13:30:00+02:00',
    title: 'Wissel!',
    body: 'Rond jullie opdracht af en ga naar Nieuwmarkt 4. Vergeet onderweg de algemene opdrachten niet.',
    classCodes: ['LM1A', 'LM1B', 'LM1C'],
  },
  {
    id: 'do-tweede-wissel-naar-ndsm',
    scheduledAt: '2026-08-27T13:30:00+02:00',
    title: 'Wissel!',
    body: 'Rond jullie opdracht af en ga naar NDSM-Kade 4. Vergeet onderweg de algemene opdrachten niet.',
    classCodes: ['LM1D', 'LM1E', 'LM1F'],
  },
  {
    id: 'do-tweede-wissel-naar-entr',
    scheduledAt: '2026-08-27T13:30:00+02:00',
    title: 'Wissel!',
    body: 'Rond jullie opdracht af en ga direct naar ENTR, Oosterdokskade 131b. Op tijd zijn is hier extra belangrijk.',
    classCodes: ['LM1G', 'LM1H'],
  },
  {
    id: 'do-laatste-kans-city-game',
    scheduledAt: '2026-08-27T14:00:00+02:00',
    title: 'Laatste kans!',
    body: 'De punten blijven binnenstromen. Blijf doorgaan: de strijd om de hoofdprijs is nog volop bezig.',
  },
  {
    id: 'do-city-game-gesloten',
    scheduledAt: '2026-08-27T15:00:00+02:00',
    title: 'De City Game zit erop!',
    body: 'Inzendingen tellen niet meer mee. Ga nu naar Inholland Amsterdam voor het BLEND-festival.',
  },
  {
    id: 'do-blend-deuren',
    scheduledAt: '2026-08-27T15:30:00+02:00',
    title: 'Zijn jullie er al?',
    body: 'Over 30 minuten opent de Sluisbuurtzaal (02.220). De inloop duurt tot 16:15 uur, dus zorg dat je op tijd bent.',
  },
  {
    id: 'do-blend-vijf-minuten',
    scheduledAt: '2026-08-27T15:55:00+02:00',
    title: 'Nog 5 minuten!',
    body: 'Kom naar de Sluisbuurtzaal (02.220), verdien de laatste punten en kijk samen de foto’s van de introweek terug.',
  },
  {
    id: 'do-blend-deuren-sluiten',
    scheduledAt: '2026-08-27T16:10:00+02:00',
    title: 'De deuren gaan sluiten!',
    body: 'Dit is je laatste kans om deel te nemen aan het programma in de Sluisbuurtzaal (02.220).',
  },
  {
    id: 'do-andrea',
    scheduledAt: '2026-08-27T17:15:00+02:00',
    title: 'Queue voor Andrea!',
    body: 'Over 15 minuten begint het optreden. Wie durft een selfie te maken en bonuspunten voor de klas te verdienen?',
  },
  {
    id: 'do-kokomo',
    scheduledAt: '2026-08-27T17:20:00+02:00',
    title: 'Eindborrel bij Kokomo',
    body: 'Vanaf 18:00 uur ben je welkom bij Kokomo Amsterdam, Zuiderzeeweg 11 A, voor de eindborrel en prijsuitreiking.',
  },
]

export function getDueScheduledMessages(classCode: string, referenceDate = new Date()) {
  const normalizedClassCode = classCode.trim().toUpperCase()

  return scheduledMessages
    .filter((message) => {
      const isReleased = new Date(message.scheduledAt).getTime() <= referenceDate.getTime()
      const isForClass = !message.classCodes || message.classCodes.includes(normalizedClassCode)
      return isReleased && isForClass && allClasses.includes(normalizedClassCode)
    })
    .sort((left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime())
}
