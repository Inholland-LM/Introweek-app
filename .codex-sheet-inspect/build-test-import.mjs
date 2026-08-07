import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = path.resolve('..', 'outputs', 'introweek-import-template', 'LMAmsterdam_Introweek_Importsjabloon_Vereenvoudigd.xlsx')
const outputDir = path.resolve('..', 'outputs', 'introweek-import-test')
const outputPath = path.join(outputDir, 'LM-YOU_Introweek_Testimport_4_profielen.xlsx')
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath))
const people = workbook.worksheets.getItem('Personen')

people.getRange('A2:H5').values = [
  ['TEST-STUDENT-001', 'Sofie', '', 'Teststudent', 'jacco.borsch+student@inholland.nl', 'student', 'LM1A', 'ja'],
  ['TEST-BUDDY-001', 'Bo', '', 'Testbuddy', 'jacco.borsch+buddy@inholland.nl', 'buddy', 'LM1A', 'ja'],
  ['', 'Puck', '', 'Test-POer', 'jacco.borsch+poer@inholland.nl', 'poer', 'LM1A', 'ja'],
  ['', 'Jacco', '', 'Borsch', 'jacco.borsch@inholland.nl', 'organisator', '', 'ja'],
]

await fs.mkdir(outputDir, { recursive: true })
const file = await SpreadsheetFile.exportXlsx(workbook)
await file.save(outputPath)

const check = await workbook.inspect({
  kind: 'table',
  range: 'Personen!A1:I6',
  include: 'values,formulas',
  tableMaxRows: 6,
  tableMaxCols: 9,
  maxChars: 12000,
})
console.log(check.ndjson)

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan',
})
console.log(errors.ndjson)

const preview = await workbook.render({ sheetName: 'Personen', range: 'A1:I6', scale: 1.2, format: 'png' })
await fs.writeFile(path.join(outputDir, 'preview-testimport.png'), new Uint8Array(await preview.arrayBuffer()))
console.log(outputPath)
