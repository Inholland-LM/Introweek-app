export type ImportRole = 'student' | 'buddy' | 'poer' | 'interested_teacher' | 'organizer'

export type ImportPerson = {
  studentNumber: string | null
  firstName: string
  namePrefix: string | null
  lastName: string
  email: string
  role: ImportRole
  classCode: string | null
  active: boolean
}

export type ImportIssue = {
  sheet: string
  row: number
  message: string
}

export type MasterContent = {
  classes: Array<{ classCode: string; country: string; flag: string; povUrl: string | null; classAppUrl: string | null; active: boolean; accentColor?: string | null }>
  locations: Array<{ id: string; name: string; address: string; postalCode: string; city: string; routeUrl: string | null; latitude: number | null; longitude: number | null; active: boolean }>
  programmes: Array<{ id: string; date: string; startTime: string; endTime: string | null; title: string; category: string; locationId: string | null; classCodes: string[] | 'all'; description: string | null; order: number; active: boolean }>
  messages: Array<{
    id: string
    scheduledAt: string
    expiresAt?: string | null
    title: string
    body: string
    classCodes: string[] | 'all'
    roles: ImportRole[]
    recipientProfileIds?: string[]
    channel: 'in-app' | 'push' | 'both'
    linkUrl: string | null
    backfillOnClassChange?: boolean
    priority?: 'normal' | 'important'
    active: boolean
  }>
  povAssignments: Array<{ id: string; title: string; description: string; classCodes: string[] | 'all'; deadlineAt: string; maxUploads: number; active: boolean }>
  practical: Array<{ id: string; category: string; title: string; body: string; order: number; active: boolean }>
  discounts: Array<{ id: string; name: string; description: string; address: string | null; routeUrl: string | null; terms: string | null; validFrom: string; validUntil: string; active: boolean }>
  settings: Record<string, string>
}

export type ImportPreview = {
  fileName: string
  rows: ImportPerson[]
  issues: ImportIssue[]
  content: MasterContent
}

const expectedHeaders = [
  'studentnummer',
  'voornaam',
  'tussenvoegsel',
  'achternaam',
  'email',
  'rol',
  'klascode',
  'actief',
]

const classCodes = new Set(['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H'])
const sourceRoles = new Map<string, ImportRole>([
  ['student', 'student'],
  ['buddy', 'buddy'],
  ['poer', 'poer'],
  ['interested_teacher', 'interested_teacher'],
  ['geïnteresseerde docent', 'interested_teacher'],
  ['geinteresseerde docent', 'interested_teacher'],
  ['docent', 'interested_teacher'],
  ['medewerker', 'interested_teacher'],
  ['organisator', 'organizer'],
  ['organizer', 'organizer'],
])

function normalize(value: string) {
  return value.trim()
}

function normalizedEmail(value: string) {
  return normalize(value).toLowerCase()
}

function isSchoolEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseYesNo(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'ja' ? true : normalized === 'nee' ? false : null
}

function parseDate(value: string) {
  const normalized = value.trim()
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const nl = normalized.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (!nl) return null
  return `${nl[3]}-${nl[2].padStart(2, '0')}-${nl[1].padStart(2, '0')}`
}

function parseTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function readSheet(XLSX: typeof import('@e965/xlsx'), workbook: ReturnType<typeof XLSX.read>, name: string, headers: string[], issues: ImportIssue[], optionalHeaders: string[] = []) {
  const worksheet = workbook.Sheets[name]
  if (!worksheet) {
    issues.push({ sheet: name, row: 1, message: `tabblad “${name}” ontbreekt` })
    return [] as string[][]
  }
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(worksheet, { header: 1, defval: '', raw: false })
  const allHeaders = [...headers, ...optionalHeaders]
  const actual = allHeaders.map((_, index) => normalize(String(rows[0]?.[index] ?? '')).toLowerCase())
  headers.forEach((header, index) => {
    if (actual[index] !== header) issues.push({ sheet: name, row: 1, message: `kolom ${index + 1} moet “${header}” heten` })
  })
  optionalHeaders.forEach((header, optionalIndex) => {
    const index = headers.length + optionalIndex
    if (actual[index] && actual[index] !== header) issues.push({ sheet: name, row: 1, message: `optionele kolom ${index + 1} moet “${header}” heten` })
  })
  return rows.slice(1).map((row) => allHeaders.map((_, index) => normalize(String(row[index] ?? '')))).filter((row) => row.some(Boolean))
}

function registerId(sheet: string, row: number, id: string, seen: Set<string>, issues: ImportIssue[]) {
  if (!id) issues.push({ sheet, row, message: 'unieke ID ontbreekt' })
  else if (seen.has(id)) issues.push({ sheet, row, message: `ID “${id}” komt meer dan één keer voor` })
  else seen.add(id)
}

function parseMasterContent(XLSX: typeof import('@e965/xlsx'), workbook: ReturnType<typeof XLSX.read>, issues: ImportIssue[]): MasterContent {
  const classRows = readSheet(XLSX, workbook, 'Klassen', ['klascode', 'land', 'vlag', 'pov_url', 'klassenapp_url', 'actief'], issues, ['accentkleur'])
  const classes = classRows.map((row, index) => {
    const active = parseYesNo(row[5])
    if (!row[0] || !row[1]) issues.push({ sheet: 'Klassen', row: index + 2, message: 'klascode en land zijn verplicht' })
    if (active === null) issues.push({ sheet: 'Klassen', row: index + 2, message: 'actief moet ja of nee zijn' })
    if (row[6] && !/^#[0-9a-f]{6}$/i.test(row[6])) issues.push({ sheet: 'Klassen', row: index + 2, message: 'accentkleur moet een hexkleur zijn, bijvoorbeeld #E3004F' })
    return { classCode: row[0].toUpperCase(), country: row[1], flag: row[2], povUrl: row[3] || null, classAppUrl: row[4] || null, active: active ?? false, accentColor: row[6] || null }
  })
  const validClasses = new Set(classes.map((item) => item.classCode))

  const locationIds = new Set<string>()
  const locationRows = readSheet(XLSX, workbook, 'Locaties', ['locatie_id', 'naam', 'adres', 'postcode', 'plaats', 'route_url', 'latitude', 'longitude', 'actief'], issues)
  const locations = locationRows.map((row, index) => {
    registerId('Locaties', index + 2, row[0], locationIds, issues)
    const active = parseYesNo(row[8])
    const latitude = row[6] ? Number(row[6].replace(',', '.')) : null
    const longitude = row[7] ? Number(row[7].replace(',', '.')) : null
    if (!row[1] || !row[2] || !row[4]) issues.push({ sheet: 'Locaties', row: index + 2, message: 'naam, adres en plaats zijn verplicht' })
    if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) issues.push({ sheet: 'Locaties', row: index + 2, message: 'latitude en longitude moeten getallen zijn' })
    if (active === null) issues.push({ sheet: 'Locaties', row: index + 2, message: 'actief moet ja of nee zijn' })
    return { id: row[0], name: row[1], address: row[2], postalCode: row[3], city: row[4], routeUrl: row[5] || null, latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null, active: active ?? false }
  })

  const programmeIds = new Set<string>()
  const programmeRows = readSheet(XLSX, workbook, 'Programma', ['programma_id', 'datum', 'starttijd', 'eindtijd', 'titel', 'categorie', 'locatie_id', 'klassen', 'omschrijving', 'volgorde', 'actief'], issues)
  const programmes = programmeRows.map((row, index) => {
    registerId('Programma', index + 2, row[0], programmeIds, issues)
    const date = parseDate(row[1]); const startTime = parseTime(row[2]); const endTime = row[3] ? parseTime(row[3]) : null
    const active = parseYesNo(row[10]); const order = Number(row[9])
    const codes = row[7].toUpperCase() === 'ALLE' ? 'all' as const : splitList(row[7].toUpperCase())
    if (!date || !startTime || (row[3] && !endTime)) issues.push({ sheet: 'Programma', row: index + 2, message: 'datum of tijd heeft geen geldig formaat' })
    if (!row[4] || !row[5]) issues.push({ sheet: 'Programma', row: index + 2, message: 'titel en categorie zijn verplicht' })
    if (row[6] && !locationIds.has(row[6])) issues.push({ sheet: 'Programma', row: index + 2, message: `locatie_id “${row[6]}” bestaat niet` })
    if (codes !== 'all' && (!codes.length || codes.some((code) => !validClasses.has(code)))) issues.push({ sheet: 'Programma', row: index + 2, message: 'één of meer klassen bestaan niet' })
    if (!Number.isFinite(order)) issues.push({ sheet: 'Programma', row: index + 2, message: 'volgorde moet een getal zijn' })
    if (active === null) issues.push({ sheet: 'Programma', row: index + 2, message: 'actief moet ja of nee zijn' })
    return { id: row[0], date: date ?? '', startTime: startTime ?? '', endTime, title: row[4], category: row[5], locationId: row[6] || null, classCodes: codes, description: row[8] || null, order: Number.isFinite(order) ? order : 0, active: active ?? false }
  })

  const messageIds = new Set<string>()
  const messageRows = readSheet(
    XLSX,
    workbook,
    'Berichten',
    ['bericht_id', 'datum', 'tijd', 'titel', 'berichttekst', 'klassen', 'rollen', 'kanaal', 'link_url', 'actief'],
    issues,
    ['geldig_tot_datum', 'geldig_tot_tijd', 'inhalen_bij_klaswissel', 'prioriteit', 'ontvanger_profiel_ids'],
  )
  const messages = messageRows.map((row, index) => {
    registerId('Berichten', index + 2, row[0], messageIds, issues)
    const date = parseDate(row[1]); const time = parseTime(row[2]); const active = parseYesNo(row[9])
    const codes = row[5].toUpperCase() === 'ALLE' ? 'all' as const : splitList(row[5].toUpperCase())
    const roles = splitList(row[6].toLowerCase()).map((role) => sourceRoles.get(role) ?? role as ImportRole)
    const channel = row[7].toLowerCase() as 'in-app' | 'push' | 'both'
    const expiresDate = row[10] ? parseDate(row[10]) : null
    const expiresTime = row[11] ? parseTime(row[11]) : null
    const backfill = row[12] ? parseYesNo(row[12]) : false
    const priority = (row[13] || 'normaal').toLowerCase()
    const recipientProfileIds = splitList(row[14])
    if (!date || !time) issues.push({ sheet: 'Berichten', row: index + 2, message: 'datum of tijd heeft geen geldig formaat' })
    if (!row[3] || !row[4]) issues.push({ sheet: 'Berichten', row: index + 2, message: 'titel en berichttekst zijn verplicht' })
    if (codes !== 'all' && (!codes.length || codes.some((code) => !validClasses.has(code)))) issues.push({ sheet: 'Berichten', row: index + 2, message: 'één of meer klassen bestaan niet' })
    if (!roles.length || roles.some((role) => !['student', 'buddy', 'poer', 'interested_teacher', 'organizer'].includes(role))) issues.push({ sheet: 'Berichten', row: index + 2, message: 'rollen zijn ongeldig' })
    if (!['in-app', 'push', 'both'].includes(channel)) issues.push({ sheet: 'Berichten', row: index + 2, message: 'kanaal moet in-app, push of both zijn' })
    if ((row[10] && !expiresDate) || (row[11] && !expiresTime) || Boolean(row[10]) !== Boolean(row[11])) issues.push({ sheet: 'Berichten', row: index + 2, message: 'geldig_tot_datum en geldig_tot_tijd moeten samen een geldige datum en tijd bevatten' })
    if (row[12] && backfill === null) issues.push({ sheet: 'Berichten', row: index + 2, message: 'inhalen_bij_klaswissel moet ja of nee zijn' })
    if (!['normaal', 'belangrijk'].includes(priority)) issues.push({ sheet: 'Berichten', row: index + 2, message: 'prioriteit moet normaal of belangrijk zijn' })
    if (recipientProfileIds.some((profileId) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId))) issues.push({ sheet: 'Berichten', row: index + 2, message: 'ontvanger_profiel_ids bevat een ongeldige profiel-ID' })
    if (active === null) issues.push({ sheet: 'Berichten', row: index + 2, message: 'actief moet ja of nee zijn' })
    const scheduledAt = date && time ? `${date}T${time}:00+02:00` : ''
    const expiresAt = expiresDate && expiresTime ? `${expiresDate}T${expiresTime}:00+02:00` : null
    if (scheduledAt && expiresAt && new Date(expiresAt).getTime() <= new Date(scheduledAt).getTime()) issues.push({ sheet: 'Berichten', row: index + 2, message: 'geldig_tot moet na het verzendmoment liggen' })
    return { id: row[0], scheduledAt, expiresAt, title: row[3], body: row[4], classCodes: codes, roles, recipientProfileIds: recipientProfileIds.length ? recipientProfileIds : undefined, channel, linkUrl: row[8] || null, backfillOnClassChange: backfill ?? false, priority: priority === 'belangrijk' ? 'important' as const : 'normal' as const, active: active ?? false }
  })

  const povIds = new Set<string>()
  const povRows = readSheet(XLSX, workbook, 'POV-opdrachten', ['opdracht_id', 'naam', 'omschrijving', 'datum', 'deadline_tijd', 'klassen', 'max_fotos_per_persoon', 'actief'], issues)
  const povAssignments = povRows.map((row, index) => {
    registerId('POV-opdrachten', index + 2, row[0], povIds, issues)
    const date = parseDate(row[3])
    const time = parseTime(row[4])
    const codes = row[5].toUpperCase() === 'ALLE' ? 'all' as const : splitList(row[5].toUpperCase())
    const maxUploads = Number(row[6])
    const active = parseYesNo(row[7])
    if (!row[1] || !row[2]) issues.push({ sheet: 'POV-opdrachten', row: index + 2, message: 'naam en omschrijving zijn verplicht' })
    if (!date || !time) issues.push({ sheet: 'POV-opdrachten', row: index + 2, message: 'datum of deadline_tijd heeft geen geldig formaat' })
    if (codes !== 'all' && (!codes.length || codes.some((code) => !validClasses.has(code)))) issues.push({ sheet: 'POV-opdrachten', row: index + 2, message: 'één of meer klassen bestaan niet' })
    if (!Number.isInteger(maxUploads) || maxUploads < 1 || maxUploads > 10) issues.push({ sheet: 'POV-opdrachten', row: index + 2, message: 'max_fotos_per_persoon moet een geheel getal van 1 t/m 10 zijn' })
    if (active === null) issues.push({ sheet: 'POV-opdrachten', row: index + 2, message: 'actief moet ja of nee zijn' })
    return {
      id: row[0],
      title: row[1],
      description: row[2],
      classCodes: codes,
      deadlineAt: date && time ? `${date}T${time}:00+02:00` : '',
      maxUploads: Number.isInteger(maxUploads) ? maxUploads : 1,
      active: active ?? false,
    }
  })

  const parseSimple = (sheet: 'Praktisch' | 'Kortingen') => readSheet(XLSX, workbook, sheet, sheet === 'Praktisch'
    ? ['item_id', 'categorie', 'titel', 'tekst', 'volgorde', 'actief']
    : ['korting_id', 'naam', 'omschrijving', 'adres', 'route_url', 'voorwaarden', 'geldig_vanaf', 'geldig_tot', 'actief'], issues)
  const practicalIds = new Set<string>()
  const practical = parseSimple('Praktisch').map((row, index) => {
    const active = parseYesNo(row[5])
    const order = Number(row[4])
    const invalidFields = [
      !row[1] && 'categorie',
      !row[2] && 'titel',
      !row[3] && 'tekst',
      !Number.isFinite(order) && 'volgorde',
      active === null && 'actief',
    ].filter(Boolean)
    registerId('Praktisch', index + 2, row[0], practicalIds, issues)
    if (invalidFields.length) issues.push({ sheet: 'Praktisch', row: index + 2, message: `controleer: ${invalidFields.join(', ')}` })
    return { id: row[0], category: row[1], title: row[2], body: row[3], order: Number.isFinite(order) ? order : 0, active: active ?? false }
  })
  const discountIds = new Set<string>()
  const discounts = parseSimple('Kortingen').map((row, index) => {
    const active = parseYesNo(row[8])
    const validFrom = parseDate(row[6])
    const validUntil = parseDate(row[7])
    const invalidFields = [
      !row[1] && 'naam',
      !row[2] && 'omschrijving',
      !validFrom && 'geldig_vanaf',
      !validUntil && 'geldig_tot',
      active === null && 'actief',
    ].filter(Boolean)
    registerId('Kortingen', index + 2, row[0], discountIds, issues)
    if (invalidFields.length) issues.push({ sheet: 'Kortingen', row: index + 2, message: `controleer: ${invalidFields.join(', ')}` })
    return { id: row[0], name: row[1], description: row[2], address: row[3] || null, routeUrl: row[4] || null, terms: row[5] || null, validFrom: validFrom ?? '', validUntil: validUntil ?? '', active: active ?? false }
  })
  const settingsRows = readSheet(XLSX, workbook, 'Instellingen', ['instelling_id', 'waarde', 'toelichting'], issues)
  const settings = Object.fromEntries(settingsRows.filter((row) => row[0]).map((row) => [row[0], row[1]]))

  return { classes, locations, programmes, messages, povAssignments, practical, discounts, settings }
}

export async function parseImportWorkbook(file: File): Promise<ImportPreview> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Kies het aangeleverde Excelbestand met de extensie .xlsx.')
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Dit bestand is groter dan 5 MB. Controleer of alleen de deelnemersgegevens in het sjabloon staan.')
  }

  const data = await file.arrayBuffer()
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(data, { type: 'array' })
  const worksheet = workbook.Sheets.Personen
  if (!worksheet) throw new Error('Het tabblad “Personen” ontbreekt. Gebruik het officiële importsjabloon.')

  const sheetRows = XLSX.utils.sheet_to_json<Array<string | number>>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  const actualHeaders = expectedHeaders.map((_, index) => normalize(String(sheetRows[0]?.[index] ?? '')).toLowerCase())
  const invalidHeader = expectedHeaders.findIndex((header, index) => actualHeaders[index] !== header)
  if (invalidHeader >= 0) {
    throw new Error(`Kolom ${invalidHeader + 1} moet “${expectedHeaders[invalidHeader]}” heten. Wijzig de kolomnamen niet.`)
  }

  const rows: ImportPerson[] = []
  const issues: ImportIssue[] = []
  const studentNumbers = new Map<string, number>()
  const emails = new Map<string, number>()

  for (let rowNumber = 2; rowNumber <= Math.min(sheetRows.length, 501); rowNumber += 1) {
    const values = expectedHeaders.map((_, index) => normalize(String(sheetRows[rowNumber - 1]?.[index] ?? '')))
    if (values.every((value) => !value)) continue

    const [studentNumber, firstName, namePrefix, lastName, rawEmail, rawRole, rawClassCode, rawActive] = values
    const email = normalizedEmail(rawEmail)
    const sourceRole = rawRole.toLowerCase()
    const role = sourceRoles.get(sourceRole)
    const classCode = rawClassCode.toUpperCase()
    const active = rawActive.toLowerCase()

    const rowIssues: string[] = []
    if (!firstName) rowIssues.push('voornaam ontbreekt')
    if (!lastName) rowIssues.push('achternaam ontbreekt')
    if (!email) rowIssues.push('e-mailadres ontbreekt')
    else if (!isSchoolEmail(email)) rowIssues.push('e-mailadres is ongeldig')
    if (!role) rowIssues.push('rol is ongeldig')
    if ((role === 'student' || role === 'buddy') && !studentNumber) rowIssues.push('studentnummer ontbreekt')
    if (role && ['student', 'buddy', 'poer'].includes(role) && !classCode) rowIssues.push('klascode ontbreekt')
    if (classCode && !classCodes.has(classCode)) rowIssues.push('klascode is ongeldig')
    if (active !== 'ja' && active !== 'nee') rowIssues.push('actief moet ja of nee zijn')

    if (studentNumber) {
      const firstRow = studentNumbers.get(studentNumber)
      if (firstRow) rowIssues.push(`studentnummer staat ook op rij ${firstRow}`)
      else studentNumbers.set(studentNumber, rowNumber)
    }

    if (email) {
      const firstRow = emails.get(email)
      if (firstRow) rowIssues.push(`e-mailadres staat ook op rij ${firstRow}`)
      else emails.set(email, rowNumber)
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues.map((message) => ({ sheet: 'Personen', row: rowNumber, message })))
      continue
    }

    rows.push({
      studentNumber: studentNumber || null,
      firstName,
      namePrefix: namePrefix || null,
      lastName,
      email,
      role: role ?? 'student',
      classCode: classCode || null,
      active: active === 'ja',
    })
  }

  if (sheetRows.length > 501) issues.push({ sheet: 'Personen', row: 502, message: 'meer dan 500 personen; splits of controleer het bestand' })
  if (rows.length === 0 && issues.length === 0) issues.push({ sheet: 'Personen', row: 2, message: 'geen personen gevonden' })

  const content = parseMasterContent(XLSX, workbook, issues)
  return { fileName: file.name, rows, issues, content }
}
