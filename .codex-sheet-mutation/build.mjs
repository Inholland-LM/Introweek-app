import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = path.resolve('..', 'outputs', 'introweek-import-test', 'LM-YOU_Introweek_Testimport_4_profielen.xlsx')
const outputDir = path.resolve('..', 'outputs', 'introweek-import-test')
const outputPath = path.join(outputDir, 'LM-YOU_Testmutatie_Sofie_naar_LM1B.xlsx')
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath))
const people = workbook.worksheets.getItem('Personen')

people.getRange('G2').values = [['LM1B']]

const check = await workbook.inspect({
  kind: 'table',
  range: 'Personen!A1:I5',
  include: 'values,formulas',
  tableMaxRows: 5,
  tableMaxCols: 9,
  maxChars: 10000,
})
console.log(check.ndjson)

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan',
})
console.log(errors.ndjson)

await fs.mkdir(outputDir, { recursive: true })
const file = await SpreadsheetFile.exportXlsx(workbook)
await file.save(outputPath)
const preview = await workbook.render({ sheetName: 'Personen', range: 'A1:I5', scale: 1.2, format: 'png' })
await fs.writeFile(path.join(outputDir, 'preview-testmutatie.png'), new Uint8Array(await preview.arrayBuffer()))
console.log(outputPath)
