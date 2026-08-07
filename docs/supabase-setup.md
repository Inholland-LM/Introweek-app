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

Voer voor het organisatiebrede Excel-masterbestand daarna ook `supabase/migrations/007_master_content_snapshot.sql` uit. Deze migratie voegt de compacte versiegestuurde inhoudssnapshot en de atomaire masterimport toe. Zie `docs/masterbestand-import.md` voor het importcontract.

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

De vaste operationele berichten voor 25, 26 en 27 augustus staan bewust in
`src/scheduledMessages.ts`. De app geeft een bericht pas na het ingestelde
tijdstip vrij en filtert klasvarianten lokaal. Daardoor wordt een algemeen
bericht niet ruim 300 keer uit Supabase gedownload. Alleen de gelezen-status
van deze vaste berichten wordt op het eigen toestel bewaard. Persoonlijke
mutaties, zoals een klaswijziging, blijven via de beveiligde Supabase-tabel en
Realtime lopen.

## Persoonlijke contactpersonen activeren

Voer na de identiteitsbasis ook
`supabase/migrations/006_personal_class_contacts.sql` uit. Deze functie geeft
een ingelogde deelnemer uitsluitend de actieve buddy's en PO'er van de eigen
klas. De app vraagt deze kleine lijst pas op wanneer **Contact & hulp** wordt
geopend en hergebruikt het resultaat daarna lokaal.

Het inlogscherm staat klaar, maar `VITE_AUTH_ENABLED` blijft uit totdat SMTP en
fictieve accounts volledig zijn getest. De actuele activeringsvolgorde en
terugvalprocedure staan in `docs/auth-rollout.md`.

## Private POV-inzendingen activeren

Voer na migratie 007 ook `supabase/migrations/008_private_pov_uploads.sql` uit. Deze migratie maakt een private Storage-bucket en beveiligde metadata aan. Studenten en buddy's kunnen uitsluitend voor hun eigen actieve klasopdrachten insturen. Alleen de organisatie kan de gezamenlijke lijst bekijken. Bestanden worden niet openbaar gemaakt en krijgen bij het bekijken een tijdelijke link van vijf minuten.

De app comprimeert elke foto vóór verzending tot maximaal 1600 pixels aan de langste zijde en maximaal circa 1,5 MB. De organisatielijst haalt alleen compacte metadata op; de foto zelf wordt uitsluitend op expliciet verzoek geladen. Zo blijft het dataverbruik met ruim 300 deelnemers beheersbaar.

## E-mailinloggen veilig activeren

De inloginterface staat in de code, maar blijft in productie uitgeschakeld totdat de mailvoorziening is ingericht en met fictieve accounts is getest.

Voor ruim 300 deelnemers is de standaard mailserver van Supabase niet geschikt. Stel eerst onder **Authentication → Emails → SMTP Settings** een eigen SMTP-provider in. Pas daarna kan `VITE_AUTH_ENABLED` in GitHub op `true` worden gezet.

Voor een testaccount geldt deze volgorde:

1. voeg eerst een fictief profiel met een genormaliseerd e-mailadres toe aan `public.profiles`;
2. maak daarna in **Authentication → Users** een gebruiker met exact dat e-mailadres;
3. de databasetrigger koppelt de twee records automatisch;
4. pas het Magic Link-sjabloon aan zodat het `{{ .Token }}` toont als zescijferige inlogcode;
5. controleer na het activeren dat het account uitsluitend het eigen profiel en de eigen klasrelatie kan lezen.
