import { supabase } from '../lib/supabase'
import { fetchOrganizerPeople, type OrganizerPerson } from '../organizerPeople'
import type { MasterContent } from './parseWorkbook'

type ExportSnapshot = {
  people: OrganizerPerson[]
  content: MasterContent
  version: number
}

type SheetDefinition = {
  name: string
  headers: string[]
  rows: Array<Array<string | number>>
  widths: number[]
}

const AMSTERDAM_TIME_ZONE = 'Europe/Amsterdam'

function requireClient() {
  if (!supabase) throw new Error('De beveiligde databaseverbinding is nog niet geconfigureerd.')
  return supabase
}

function yesNo(value: boolean | undefined) {
  return value === false ? 'nee' : 'ja'
}

function classList(value: string[] | 'all') {
  return value === 'all' ? 'ALLE' : value.join(',')
}

function dateTimeParts(value: string | null | undefined) {
  if (!value) return { date: '', time: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('nl-NL', {
    timeZone: AMSTERDAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`,
  }
}

function settingExplanation(key: string) {
  const explanations: Record<string, string> = {
    app_title: 'Titel van de webapp',
    instagram_url: 'Link naar de Instagram-pagina van de introweek',
    score_freeze_at: 'Moment waarop de zichtbare tussenstand voor studenten wordt bevroren',
    country_reveal_at: 'Moment waarop landen en de landenstrijd zichtbaar worden',
  }
  return explanations[key] ?? ''
}

async function fetchExportSnapshot(): Promise<ExportSnapshot> {
  const client = requireClient()
  const [people, contentResult] = await Promise.all([
    fetchOrganizerPeople(),
    client.rpc('get_app_content'),
  ])
  if (contentResult.error) throw new Error('De actuele organisatie-inhoud kon niet worden opgehaald.')
  if (!contentResult.data?.content) throw new Error('Supabase gaf geen actuele organisatie-inhoud terug.')
  return {
    people,
    content: contentResult.data.content as MasterContent,
    version: Number(contentResult.data.version ?? 0),
  }
}

function buildSheets(snapshot: ExportSnapshot): SheetDefinition[] {
  const { people, content } = snapshot
  return [
    {
      name: 'Personen',
      headers: ['studentnummer', 'voornaam', 'tussenvoegsel', 'achternaam', 'email', 'rol', 'klascode', 'actief'],
      rows: [...people]
        .sort((left, right) => left.lastName.localeCompare(right.lastName, 'nl') || left.firstName.localeCompare(right.firstName, 'nl'))
        .map((person) => [person.studentNumber ?? '', person.firstName, person.namePrefix ?? '', person.lastName, person.email, person.role, person.classCode ?? '', yesNo(person.active)]),
      widths: [16, 18, 15, 24, 36, 24, 13, 11],
    },
    {
      name: 'Klassen',
      headers: ['klascode', 'land', 'vlag', 'pov_url', 'klassenapp_url', 'actief', 'accentkleur'],
      rows: [...content.classes]
        .sort((left, right) => left.classCode.localeCompare(right.classCode, 'nl'))
        .map((item) => [item.classCode, item.country, item.flag, item.povUrl ?? '', item.classAppUrl ?? '', yesNo(item.active), item.accentColor ?? '']),
      widths: [13, 20, 10, 34, 42, 11, 15],
    },
    {
      name: 'Locaties',
      headers: ['locatie_id', 'naam', 'adres', 'postcode', 'plaats', 'route_url', 'latitude', 'longitude', 'actief'],
      rows: [...content.locations]
        .sort((left, right) => left.name.localeCompare(right.name, 'nl'))
        .map((item) => [item.id, item.name, item.address, item.postalCode, item.city, item.routeUrl ?? '', item.latitude ?? '', item.longitude ?? '', yesNo(item.active)]),
      widths: [22, 28, 32, 13, 18, 46, 15, 15, 11],
    },
    {
      name: 'Programma',
      headers: ['programma_id', 'datum', 'starttijd', 'eindtijd', 'titel', 'categorie', 'locatie_id', 'klassen', 'omschrijving', 'volgorde', 'actief'],
      rows: [...content.programmes]
        .sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime) || left.order - right.order)
        .map((item) => [item.id, item.date, item.startTime, item.endTime ?? '', item.title, item.category, item.locationId ?? '', classList(item.classCodes), item.description ?? '', item.order, yesNo(item.active)]),
      widths: [23, 14, 12, 12, 32, 22, 22, 25, 52, 12, 11],
    },
    {
      name: 'Berichten',
      headers: ['bericht_id', 'datum', 'tijd', 'titel', 'berichttekst', 'klassen', 'rollen', 'kanaal', 'link_url', 'actief', 'geldig_tot_datum', 'geldig_tot_tijd', 'inhalen_bij_klaswissel', 'prioriteit', 'ontvanger_profiel_ids'],
      rows: [...content.messages]
        .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
        .map((item) => {
          const scheduled = dateTimeParts(item.scheduledAt)
          const expires = dateTimeParts(item.expiresAt)
          return [item.id, scheduled.date, scheduled.time, item.title, item.body, classList(item.classCodes), item.roles.join(','), item.channel, item.linkUrl ?? '', yesNo(item.active), expires.date, expires.time, yesNo(item.backfillOnClassChange ?? false), item.priority === 'important' ? 'belangrijk' : 'normaal', item.recipientProfileIds?.join(',') ?? '']
        }),
      widths: [23, 14, 12, 34, 64, 25, 38, 14, 42, 11, 18, 18, 25, 15, 54],
    },
    {
      name: 'POV-opdrachten',
      headers: ['opdracht_id', 'naam', 'omschrijving', 'datum', 'deadline_tijd', 'klassen', 'max_fotos_per_persoon', 'actief'],
      rows: [...content.povAssignments]
        .sort((left, right) => left.deadlineAt.localeCompare(right.deadlineAt))
        .map((item) => {
          const deadline = dateTimeParts(item.deadlineAt)
          return [item.id, item.title, item.description, deadline.date, deadline.time, classList(item.classCodes), item.maxUploads, yesNo(item.active)]
        }),
      widths: [23, 34, 60, 14, 18, 25, 26, 11],
    },
    {
      name: 'Praktisch',
      headers: ['item_id', 'categorie', 'titel', 'tekst', 'volgorde', 'actief'],
      rows: [...content.practical]
        .sort((left, right) => left.order - right.order)
        .map((item) => [item.id, item.category, item.title, item.body, item.order, yesNo(item.active)]),
      widths: [22, 22, 32, 68, 12, 11],
    },
    {
      name: 'Kortingen',
      headers: ['korting_id', 'naam', 'omschrijving', 'adres', 'route_url', 'voorwaarden', 'geldig_vanaf', 'geldig_tot', 'actief'],
      rows: [...content.discounts]
        .sort((left, right) => left.name.localeCompare(right.name, 'nl'))
        .map((item) => [item.id, item.name, item.description, item.address ?? '', item.routeUrl ?? '', item.terms ?? '', item.validFrom, item.validUntil, yesNo(item.active)]),
      widths: [22, 30, 54, 40, 46, 48, 16, 16, 11],
    },
    {
      name: 'Instellingen',
      headers: ['instelling_id', 'waarde', 'toelichting'],
      rows: Object.entries(content.settings)
        .sort(([left], [right]) => left.localeCompare(right, 'nl'))
        .map(([key, value]) => [key, value, settingExplanation(key)]),
      widths: [30, 54, 62],
    },
    {
      name: 'Keuzelijsten',
      headers: ['rollen', 'ja_nee', 'kanaal', 'prioriteit', 'klassen', 'toelichting'],
      rows: [
        ['student', 'ja', 'both', 'normaal', 'ALLE', 'Gebruik dit tabblad als naslag; wijzig de kolomnamen van de andere tabbladen niet.'],
        ['buddy', 'nee', 'in-app', 'belangrijk', ...[content.classes[0]?.classCode ?? 'LM1A', '']],
        ['poer', '', 'push', '', ...[content.classes[1]?.classCode ?? 'LM1B', '']],
        ['interested_teacher', '', '', '', ...[content.classes[2]?.classCode ?? 'LM1C', '']],
        ['organizer', '', '', '', ...[content.classes[3]?.classCode ?? 'LM1D', '']],
        ...content.classes.slice(4).map((item) => ['', '', '', '', item.classCode, '']),
      ],
      widths: [24, 13, 15, 15, 14, 74],
    },
  ]
}

function safeFileTimestamp() {
  const parts = dateTimeParts(new Date().toISOString())
  return `${parts.date}_${parts.time.replace(':', '')}`
}

export async function exportCurrentMasterWorkbook() {
  const snapshot = await fetchExportSnapshot()
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.utils.book_new()

  for (const definition of buildSheets(snapshot)) {
    const worksheet = XLSX.utils.aoa_to_sheet([definition.headers, ...definition.rows])
    worksheet['!cols'] = definition.widths.map((wch) => ({ wch }))
    worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(definition.headers.length - 1)}1` }
    worksheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
    worksheet['!rows'] = [{ hpt: 24 }]
    for (let column = 0; column < definition.headers.length; column += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: column })]
      if (!cell) continue
      cell.s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'E3004F' } },
        alignment: { vertical: 'center' },
      }
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, definition.name)
  }

  workbook.Props = {
    Title: 'LM = YOU Introweek – actuele masterexport',
    Subject: `Databaseversie ${snapshot.version}`,
    Author: 'LM = YOU',
    CreatedDate: new Date(),
  }

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true })
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `LM_YOU_Introweek_Masterbestand_actueel_${safeFileTimestamp()}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return { peopleCount: snapshot.people.length, version: snapshot.version }
}
