# LM = YOU masterbestand

Het masterbestand is de gecontroleerde bron voor deelnemers én organisatorische inhoud. De organisatie uploadt steeds een volledig bijgewerkte `.xlsx`.

## Begin met de actuele export

Gebruik in het organisatiedashboard bij `Personen` de knop `Excel exporteren`. De app maakt dan één momentopname van alle personen en de volledige actuele organisatie-inhoud. Het gedownloade bestand bevat dezelfde tabbladen, kolomnamen en vaste ID's als de import en kan daarom direct worden aangevuld of gewijzigd en daarna weer worden geïmporteerd.

De export gebeurt alleen wanneer een organisator op de knop drukt. Er draait hiervoor geen extra synchronisatie of polling.

De optionele kolom `ontvanger_profiel_ids` in `Berichten` bewaart gerichte berichten aan specifiek geselecteerde personen. Laat bestaande waarden ongewijzigd wanneer je alleen de tekst of planning van zo'n bericht aanpast.

## Tabbladen

- `Personen`: studenten, buddy’s, PO’ers en organisatie.
- `Klassen`: land, vlag, POV-link en klassenapp-link.
- `Locaties`: adressen, route-links en kaartcoördinaten.
- `Programma`: datum, tijden, activiteit, locatie en doelgroepklassen.
- `Berichten`: geplande berichten per klas, rol en kanaal.
- `Praktisch`: praktische informatie in Meer.
- `Kortingen`: deelnemende locaties, voorwaarden en geldigheid.
- `POV-opdrachten`: foto-opdrachten, doelgroepklassen, deadline en maximaal aantal inzendingen per persoon.
- `Instellingen`: naam, editie, evenementdatums en overige algemene waarden.
- `Keuzelijsten`: invoerwaarden voor Excel-validatie; niet hernoemen.

## Vaste ID’s

Elke inhoudsregel heeft een stabiele ID. Een bestaande ID mag worden aangepast, maar niet worden vervangen wanneer alleen de inhoud wijzigt. Zet `actief` op `nee` om een onderdeel te verbergen. Als een bestaande ID volledig ontbreekt, blokkeert de vergelijking de import om onbedoeld verlies te voorkomen.

## Veilige verwerking

1. Het bestand wordt lokaal gelezen en volledig gevalideerd.
2. Verwijzingen tussen klassen, programma’s en locaties worden gecontroleerd.
3. De app vergelijkt personen én inhoud met de actuele database.
4. De organisator ziet de mutaties voordat iets wordt opgeslagen.
5. Na de tweede bevestiging worden personen en inhoud in één database-transactie verwerkt.
6. Als de database intussen is gewijzigd of een onderdeel faalt, wordt alles teruggedraaid.

## Lage egress

De actieve organisatie-inhoud staat als één compacte JSON-snapshot in Supabase. Een toestel bewaart de snapshot lokaal en controleert maximaal eens per vijf minuten alleen het kleine versienummer. Alleen na een echte inhoudswijziging wordt de volledige snapshot opnieuw opgehaald. De vaste Excel-inhoud wordt dus niet per scherm of per tabel opnieuw gedownload.

## Onderdelen tonen of verbergen

Gebruik in `Instellingen` de sleutels `toon_praktisch`, `toon_kortingen` en `toon_pov`. De waarde `nee` verbergt het onderdeel. Bij `ja` wordt Praktisch of Kortingen alsnog automatisch verborgen wanneer er geen actieve regels zijn. POV-foto's worden alleen aan studenten en buddy's getoond wanneer er voor hun klas een actieve opdracht of bestaande externe POV-link is.

## POV-foto's

Foto's worden niet in het Excelbestand opgeslagen. Het tabblad `POV-opdrachten` bepaalt welke opdracht voor welke klas openstaat. De app maakt op het toestel een hoogwaardige JPEG met een langste zijde van maximaal 2560 pixels en een bestandsgrootte van maximaal circa 2 MB. Die versie is geschikt als bron voor de aftermovie en wordt opgeslagen in de private Storage-bucket `pov-inzendingen`, met opdracht, klas, deelnemer en tijdstip als beveiligde metadata.

Alleen de organisatie kan inzendingen en bestanden bekijken. De organisatie laadt eerst uitsluitend metadata; een afbeelding krijgt pas bij `Bekijk foto` een vijf minuten geldige URL. Studenten en buddy's kunnen uitsluitend uploaden en krijgen geen klasgalerij. Dit beperkt privacyrisico's en Supabase-egress.

## Landenstrijd en BLEND-finale

Het organisatiedashboard publiceert één klasscore voor HAG, SX en de gecombineerde City Game (CX, FRH en ENTR). Na de City Game wordt de POV-onthullingsvolgorde vastgezet op basis van de dan geldende stand. Bij gelijke scores bepaalt de organisatie handmatig de volgorde.

De jury bepaalt buiten de individuele foto-inzendingen één POV-eindtotaal per klas. Deze conceptscores worden tijdens BLEND van de oorspronkelijke plek 8 naar plek 1 handmatig onthuld. Iedere onthulling moet apart door de organisatie worden gestart; het volgende land start nooit automatisch. Supabase bewaart de volgorde en voortgang centraal, terwijl realtime broadcasts alleen een compacte verversing naar geopende apps sturen.

## Privacy

Neem geen woonadressen, telefoonnummers, geboortedata, privé-mailadressen of foto’s van deelnemers op. Alleen de organisatie mag het masterbestand uploaden en definitief verwerken.
