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

Er wordt nog geen inlogscherm getoond en de bestaande demo blijft volledig lokaal werken. De volgende stap is het toevoegen van e-mailinloggen en een test met fictieve accounts, voordat echte persoonsgegevens worden geïmporteerd.
