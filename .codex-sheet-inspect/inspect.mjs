import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = path.resolve('..', 'outputs', 'introweek-import-template', 'LMAmsterdam_Introweek_Importsjabloon_Vereenvoudigd.xlsx')
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath))

const sheets = await workbook.inspect({
  kind: 'sheet',
  include: 'id,name',
  maxChars: 8000,
})
console.log('SHEETS')
console.log(sheets.ndjson)

const overview = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 20000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
})
console.log('OVERVIEW')
console.log(overview.ndjson)

await fs.mkdir('renders', { recursive: true })
for (const sheet of workbook.worksheets.items) {
  const preview = await workbook.render({ sheetName: sheet.name, autoCrop: 'all', scale: 1, format: 'png' })
  await fs.writeFile(path.join('renders', `${sheet.name}.png`), new Uint8Array(await preview.arrayBuffer()))
}
