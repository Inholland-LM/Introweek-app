import XLSX from '@e965/xlsx'
import fs from 'fs'
import path from 'path'

// Sheet 1: Personen
const personenData = [
  ['studentnummer', 'voornaam', 'tussenvoegsel', 'achternaam', 'e-mailadres', 'rol', 'klas', 'actief'],
  ['689101', 'Sofia', '', 'Jansen', '689101@student.inholland.nl', 'student', 'LM1A', 'ja'],
  ['689102', 'Lucas', 'de', 'Groot', '689102@student.inholland.nl', 'student', 'LM1A', 'ja'],
  ['689103', 'Emma', '', 'Visser', 'emma.visser@inholland.nl', 'buddy', 'LM1A', 'ja'],
  ['689104', 'Daan', '', 'Bakker', 'daan.bakker@inholland.nl', 'poer', 'LM1A', 'ja'],
  ['689105', 'Kees', 'van', 'Dijk', 'kees.vandijk@inholland.nl', 'interested_teacher', 'LM1A', 'ja'],
  ['689106', 'Sanne', '', 'Mulder', '689106@student.inholland.nl', 'student', 'LM1B', 'ja'],
  ['689107', 'Milan', '', 'Smit', 'milan.smit@inholland.nl', 'buddy', 'LM1B', 'ja'],
  ['689108', 'Tess', 'de', 'Ruiter', 'tess.deruiter@inholland.nl', 'interested_teacher', 'LM1B', 'ja'],
]

// Sheet 2: Klassen
const klassenData = [
  ['klascode', 'land', 'vlag', 'pov_url', 'klassenapp_url', 'actief'],
  ['LM1A', 'Australië', '🇦🇺', '', 'https://chat.whatsapp.com/demo-lm1a', 'ja'],
  ['LM1B', 'Brazilië', '🇧🇷', '', 'https://chat.whatsapp.com/demo-lm1b', 'ja'],
  ['LM1C', 'Canada', '🇨🇦', '', '', 'ja'],
  ['LM1D', 'Denemarken', '🇩🇰', '', '', 'ja'],
]

// Sheet 3: Locaties
const locatiesData = [
  ['locatie_id', 'naam', 'adres', 'postcode', 'plaats', 'route_url', 'latitude', 'longitude', 'actief'],
  ['loc-1', 'Campus Inholland Amsterdam', 'Sluisbuurt 1', '1095 MB', 'Amsterdam', 'https://maps.google.com/?q=Inholland+Amsterdam', '52.3702', '4.8951', 'ja'],
  ['loc-2', 'NDSM-werf', 'Neveritaweg 15', '1033 WB', 'Amsterdam', 'https://maps.google.com/?q=NDSM+Werf', '52.4011', '4.8936', 'ja'],
  ['loc-3', 'Sportcentrum De Pijp', 'Lizzy Ansinghstraat 88', '1072 RD', 'Amsterdam', 'https://maps.google.com/?q=Sportcentrum+De+Pijp', '52.3522', '4.8911', 'ja'],
]

// Sheet 4: Programma
const programmaData = [
  ['programma_id', 'datum', 'starttijd', 'eindtijd', 'titel', 'categorie', 'locatie_id', 'klassen', 'omschrijving', 'volgorde', 'actief'],
  ['prog-1', '2026-08-25', '13:00', '14:15', 'Ontvangst eerstejaars', 'Campus', 'loc-1', 'ALLE', 'Welkom op de campus en ophalen goodiebag.', '1', 'ja'],
  ['prog-2', '2026-08-25', '14:30', '16:00', 'Ontdek de Sluisbuurt', 'Wandeltocht', 'loc-2', 'LM1A,LM1B', 'Interactieve speurtocht door de wijk.', '2', 'ja'],
  ['prog-3', '2026-08-25', '16:15', '18:00', 'Goodiebags & borrel', 'Borrel', 'loc-1', 'ALLE', 'Gezellige afsluitende borrel op het plein.', '3', 'ja'],
]

// Sheet 5: Berichten
const berichtenData = [
  ['bericht_id', 'datum', 'tijd', 'titel', 'berichttekst', 'klassen', 'rollen', 'kanaal', 'link_url', 'actief'],
  ['msg-1', '2026-08-25', '12:30', '🌧️ Welkom op de Introweek!', 'Verzamelen om 13:00 in de centrale hal van de campus.', 'ALLE', 'student,buddy,poer,interested_teacher', 'push', '', 'ja'],
]

// Sheet 6: POV-opdrachten
const povData = [
  ['opdracht_id', 'naam', 'omschrijving', 'datum', 'deadline_tijd', 'klassen', 'max_fotos_per_klas', 'actief'],
  ['pov-1', 'Klasfoto op het NDSM-terrein', 'Maak de meest creatieve groepsfoto met je hele klas op de NDSM-werf!', '2026-08-25', '17:00', 'ALLE', '5', 'ja'],
]

// Sheet 7: Praktisch
const praktischData = [
  ['item_id', 'categorie', 'titel', 'tekst', 'volgorde', 'actief'],
  ['prak-1', 'Toegang', 'Polsbandje', 'Draag het de hele introweek voor toegang en kortingen.', '1', 'ja'],
  ['prak-2', 'Meenemen', 'Wat neem je mee?', 'Opgeladen telefoon, powerbank, water en bescherming tegen het weer.', '2', 'ja'],
  ['prak-3', 'Contact', 'Ben je later?', 'Stuur je naam, reden en verwachte aankomsttijd in de klassenapp.', '3', 'ja'],
]

// Sheet 8: Kortingen
const kortingenData = [
  ['korting_id', 'naam', 'omschrijving', 'adres', 'route_url', 'voorwaarden', 'geldig_vanaf', 'geldig_tot', 'actief'],
  ['kort-1', '10% Korting bij Espressobar', 'Op vertoon van je Inholland polsbandje.', 'Sluisbuurt 5', '', 'Geldig tijdens de introweek', '2026-08-27', '2026-08-27', 'ja'],
]

// Sheet 9: Instellingen
const instellingenData = [
  ['instelling_id', 'waarde', 'toelichting'],
  ['app_title', 'LM = YOU Intro 2026', 'Titel van de webapp'],
]

const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(personenData), 'Personen')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(klassenData), 'Klassen')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(locatiesData), 'Locaties')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(programmaData), 'Programma')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(berichtenData), 'Berichten')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(povData), 'POV-opdrachten')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(praktischData), 'Praktisch')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(kortingenData), 'Kortingen')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instellingenData), 'Instellingen')

const outputPath = path.join(process.cwd(), 'Introweek_Import_Sjabloon_Voorbeeld.xlsx')
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
fs.writeFileSync(outputPath, buffer)
console.log('Sjabloon succesvol gegenereerd op:', outputPath)
