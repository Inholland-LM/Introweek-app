export type ImportRole = 'student' | 'buddy' | 'poer' | 'organizer'

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
  row: number
  message: string
}

export type ImportPreview = {
  fileName: string
  rows: ImportPerson[]
  issues: ImportIssue[]
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
const sourceRoles = new Set(['student', 'buddy', 'poer', 'organisator'])

function normalize(value: string) {
  return value.trim()
}

function normalizedEmail(value: string) {
  return normalize(value).toLowerCase()
}

function isSchoolEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
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
    const role = rawRole.toLowerCase()
    const classCode = rawClassCode.toUpperCase()
    const active = rawActive.toLowerCase()

    const rowIssues: string[] = []
    if (!firstName) rowIssues.push('voornaam ontbreekt')
    if (!lastName) rowIssues.push('achternaam ontbreekt')
    if (!email) rowIssues.push('e-mailadres ontbreekt')
    else if (!isSchoolEmail(email)) rowIssues.push('e-mailadres is ongeldig')
    if (!sourceRoles.has(role)) rowIssues.push('rol is ongeldig')
    if ((role === 'student' || role === 'buddy') && !studentNumber) rowIssues.push('studentnummer ontbreekt')
    if (role !== 'organisator' && !classCode) rowIssues.push('klascode ontbreekt')
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
      issues.push(...rowIssues.map((message) => ({ row: rowNumber, message })))
      continue
    }

    rows.push({
      studentNumber: studentNumber || null,
      firstName,
      namePrefix: namePrefix || null,
      lastName,
      email,
      role: role === 'organisator' ? 'organizer' : role as ImportRole,
      classCode: classCode || null,
      active: active === 'ja',
    })
  }

  if (sheetRows.length > 501) issues.push({ row: 502, message: 'meer dan 500 personen; splits of controleer het bestand' })
  if (rows.length === 0 && issues.length === 0) issues.push({ row: 2, message: 'geen personen gevonden' })

  return { fileName: file.name, rows, issues }
}
