# Supabase-basis activeren

De website gebruikt alleen een openbare publishable key. Geheime database- of beheersleutels mogen nooit in GitHub, de browser of een Excelbestand terechtkomen.

## Eenmalige installatie

1. Open in Supabase de **SQL Editor** van het project.
2. Open `supabase/migrations/001_identity_foundation.sql` uit deze repository.
3. Plak de volledige inhoud in een nieuwe query en kies **Run**.
4. Controleer dat Supabase `Success. No rows returned` meldt.

De migratie maakt uitsluitend de identiteitsbasis:

- vooraf te importeren profielen;
- de acht klassen en landen;
- klaslidmaatschappen;
- automatische koppeling op genormaliseerd schoolmailadres;
- Row Level Security, zodat een student alleen het eigen profiel en de eigen klasrelatie kan ophalen.

## Importvoorvertoning activeren

Voer na de identiteitsbasis ook `supabase/migrations/002_people_import_preview.sql` uit in de SQL Editor. Deze migratie voegt één alleen-lezen databasefunctie toe. Alleen een gekoppeld en actief organisatorprofiel mag die functie gebruiken.

De functie:

- ontvangt uitsluitend de lokaal genormaliseerde rijen, niet het Excelbestand;
- vergelijkt deze met de actuele profielen en klasrelaties;
- retourneert alleen totalen en gevonden mutaties;
- schrijft, activeert of deactiveert nog niets.

## Definitieve import activeren

Voer pas na migratie 002 ook `supabase/migrations/003_apply_people_import.sql` uit. Deze migratie voegt de expliciete tweede bevestigingsstap toe.

Bij definitief verwerken:

- wordt gecontroleerd of de database sinds de voorvertoning niet is gewijzigd;
- worden profielen en één klasrelatie per persoon in één transactie bijgewerkt;
- worden ontbrekende personen gedeactiveerd, nooit verwijderd;
- wordt een auditregel zonder Excelbestand of volledige persoonsgegevens opgeslagen;
- krijgen de student en betrokken buddy's en PO'ers een gerichte melding bij een klaswijziging;
- wordt bij iedere fout de volledige transactie teruggedraaid.

Voer op een installatie waarop migratie 003 al eerder is uitgevoerd vervolgens ook
`supabase/migrations/004_fix_people_import_item_alias.sql` uit. Deze gerichte
correctie voorkomt het naamconflict dat door de rollback-smoketest is gevonden.

## Persoonlijke meldingen activeren

Voer daarna `supabase/migrations/005_publish_personal_notifications.sql` uit.
Hiermee worden alleen nieuw aangemaakte meldingen via Realtime beschikbaar. Row
Level Security blijft afdwingen dat iedere gebruiker uitsluitend de eigen
meldingen ontvangt.

De app haalt bij het openen maximaal twintig eigen meldingen op. Daarna worden
alleen nieuwe rijen voor het ingelogde profiel doorgestuurd. Er is dus geen
agressieve polling en het dataverbruik blijft ook met ruim 300 deelnemers
beheersbaar.

Het inlogscherm staat klaar, maar `VITE_AUTH_ENABLED` blijft uit totdat SMTP en
fictieve accounts volledig zijn getest. De actuele activeringsvolgorde en
terugvalprocedure staan in `docs/auth-rollout.md`.

## E-mailinloggen veilig activeren

De inloginterface staat in de code, maar blijft in productie uitgeschakeld totdat de mailvoorziening is ingericht en met fictieve accounts is getest.

Voor ruim 300 deelnemers is de standaard mailserver van Supabase niet geschikt. Stel eerst onder **Authentication → Emails → SMTP Settings** een eigen SMTP-provider in. Pas daarna kan `VITE_AUTH_ENABLED` in GitHub op `true` worden gezet.

Voor een testaccount geldt deze volgorde:

1. voeg eerst een fictief profiel met een genormaliseerd e-mailadres toe aan `public.profiles`;
2. maak daarna in **Authentication → Users** een gebruiker met exact dat e-mailadres;
3. de databasetrigger koppelt de twee records automatisch;
4. pas het Magic Link-sjabloon aan zodat het `{{ .Token }}` toont als zescijferige inlogcode;
5. controleer na het activeren dat het account uitsluitend het eigen profiel en de eigen klasrelatie kan lezen.
