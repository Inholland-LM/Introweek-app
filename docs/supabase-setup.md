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

Er wordt nog geen inlogscherm getoond en de bestaande demo blijft volledig lokaal werken. De volgende stap is het toevoegen van e-mailinloggen en een test met fictieve accounts, voordat echte persoonsgegevens worden geïmporteerd.

## E-mailinloggen veilig activeren

De inloginterface staat in de code, maar blijft in productie uitgeschakeld totdat de mailvoorziening is ingericht en met fictieve accounts is getest.

Voor ruim 300 deelnemers is de standaard mailserver van Supabase niet geschikt. Stel eerst onder **Authentication → Emails → SMTP Settings** een eigen SMTP-provider in. Pas daarna kan `VITE_AUTH_ENABLED` in GitHub op `true` worden gezet.

Voor een testaccount geldt deze volgorde:

1. voeg eerst een fictief profiel met een genormaliseerd e-mailadres toe aan `public.profiles`;
2. maak daarna in **Authentication → Users** een gebruiker met exact dat e-mailadres;
3. de databasetrigger koppelt de twee records automatisch;
4. pas het Magic Link-sjabloon aan zodat het `{{ .Token }}` toont als zescijferige inlogcode;
5. controleer na het activeren dat het account uitsluitend het eigen profiel en de eigen klasrelatie kan lezen.
