# Ontwerp Excel-import en mutaties

## Doel

Een bevoegde organisator uploadt een nieuwe versie van het deelnemersbestand. De app vergelijkt die versie met de laatst geaccepteerde import, toont alle mutaties en verwerkt ze pas na expliciete bevestiging.

## Vaste sleutels per rol

De beschikbare brongegevens zijn voldoende om personen betrouwbaar te herkennen:

- voor studenten en buddy's is `studentnummer` de primaire externe sleutel;
- hun e-mailadres is een aanvullende unieke controle en mag veranderen zonder dat een nieuw persoon ontstaat;
- voor docenten en PO'ers is het blijvende, genormaliseerde e-mailadres de primaire externe sleutel;
- een naam wordt uitsluitend als weergavenaam gebruikt en nooit als unieke sleutel.

Bij de eerste import krijgt iedere persoon daarnaast een interne, onveranderlijke `persoon_id`. E-mailadressen worden voor vergelijking getrimd en naar kleine letters omgezet. Dubbele studentnummers, dubbele e-mailadressen of conflicterende rollen blokkeren de import en worden eerst aan de beheerder getoond.

Minimale kolommen:

- `studentnummer` (verplicht voor studenten en buddy's)
- `voornaam`
- `tussenvoegsel`
- `achternaam`
- `email`
- `rol` (`student`, `poer`, `buddy`, `geïnteresseerde docent` of `organisator`)
- `klascode`
- `actief`

De definitieve kolomnamen worden afgestemd op het bestaande Excelbestand. De importeur accepteert daarna steeds hetzelfde sjabloon.

Het vereenvoudigde sjabloon gebruikt één tabblad `Personen`. Iedere persoon staat precies één keer in het bestand en heeft maximaal één `klascode`. Voor studenten, buddy's en PO'ers is die klascode verplicht; voor geïnteresseerde docenten en organisatoren mag deze leeg blijven.

## Huidige implementatiestap

Een organisator kan het ingevulde `.xlsx`-bestand in de app lokaal laten controleren. De browser controleert het tabblad, de vaste kolomnamen, verplichte velden, rollen, klassen, actieve status en dubbele studentnummers of e-mailadressen. De Excel-lezer wordt pas op aanvraag geladen en het bestand wordt tijdens deze voorvertoning niet naar Supabase verstuurd.

Het opslaan en vergelijken van bevestigde mutaties wordt bewust in een volgende, afzonderlijke stap aangesloten.

## Veilige importstroom

1. Bestand uploaden in het afgeschermde beheerscherm.
2. Kolommen, waarden, dubbele sleutels en ontbrekende relaties valideren.
3. Nieuwe versie normaliseren en vergelijken met de laatst geaccepteerde snapshot.
4. Voorvertoning tonen met `nieuw`, `gewijzigd`, `gedeactiveerd` en `ongewijzigd`.
5. Per wijziging tonen welke gebruikers een melding ontvangen.
6. Organisator bevestigt de import.
7. Databasewijzigingen en notificatieopdrachten worden in één transactie opgeslagen.
8. Importlog bewaart wie, wanneer en welk bestand heeft verwerkt, plus de aantallen mutaties.

## Voorbeeld: student wisselt van klas

Bij `LM1A -> LM1B` detecteert de vergelijking een wijziging op dezelfde `persoon_id`.

Na bevestiging:

- de student ontvangt de nieuwe klas en praktische gevolgen;
- de PO'er en buddy's van LM1A ontvangen een vertrekbericht;
- de PO'er en buddy's van LM1B ontvangen een instroombericht;
- de student ziet na de eerstvolgende synchronisatie automatisch het programma en de informatie van LM1B.

Berichten worden als afzonderlijke notificatieopdrachten vastgelegd. Hierdoor kan de app fouten opnieuw proberen zonder de hele import opnieuw uit te voeren.

## Egressbeperking

- Het Excelbestand wordt één keer door de beheerder geüpload, niet door studenten gedownload.
- Studenten krijgen alleen een kleine pushmelding of realtime gebeurtenis die voor hen relevant is.
- Na een melding haalt een toestel uitsluitend het gewijzigde profiel of programmaonderdeel op.
- De app downloadt nooit de volledige studentenlijst.
- Een bestandsvingerafdruk voorkomt dat hetzelfde bestand tweemaal wordt verwerkt.
- Standaardprogramma en statische inhoud blijven lokaal gecachet.

## Privacy en herstel

- Het Excelbestand en persoonsgegevens komen nooit in de openbare GitHub-repository.
- Alleen geautoriseerde organisatoren mogen importeren.
- Een import wordt eerst als concept opgeslagen en pas na bevestiging actief.
- Iedere mutatie is herleidbaar naar een importnummer.
- Voor een foutieve import komt een gecontroleerde terugdraaioptie beschikbaar.
