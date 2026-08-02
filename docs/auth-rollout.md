# Authenticatie veilig activeren

De live app is al met Supabase verbonden, maar `VITE_AUTH_ENABLED` staat bewust
op `false`. Daardoor blijft de publieke demo werken totdat mail, fictieve accounts
en herstelroute aantoonbaar goed functioneren.

## 1. Afzender en SMTP

Gebruik een eigen domein voor alle toekomstige LM = YOU-apps. Configureer bij de
gekozen mailprovider minimaal SPF en DKIM en gebruik een functioneel afzenderadres,
bijvoorbeeld `login@<eigen-domein>` met afzendernaam `LM = YOU`.

Vul daarna in Supabase onder **Authentication > Emails > SMTP Settings** de
SMTP-gegevens in. Zet authenticatie in GitHub nog niet aan.

## 2. Inlogmail

Open in Supabase **Authentication > Email Templates > Magic Link**.

- onderwerp: inhoud van `supabase/email-templates/login-code-subject.txt`;
- bericht: inhoud van `supabase/email-templates/login-code.html`.

De app verwacht de zescijferige waarde uit `{{ .Token }}`. Gebruik in dit sjabloon
geen externe afbeeldingen of trackingpixels; zo blijft de mail snel, herkenbaar
en privacyvriendelijk.

## 3. Eerste organisator

Open `supabase/admin/create_first_organizer.sql`, vervang uitsluitend de drie
duidelijk gemarkeerde waarden en voer het bestand uit in de SQL Editor.

Maak daarna onder **Authentication > Users** een gebruiker met exact hetzelfde
genormaliseerde e-mailadres. Voer vervolgens
`supabase/admin/check_auth_readiness.sql` uit. Voor de eerste test moeten gelden:

- `gekoppelde_organisatoren` is minimaal 1;
- `meldingen_realtime_actief` is `true`;
- beide importfuncties zijn beschikbaar.

## 4. Testen met fictieve accounts

Gebruik eerst een organisator, student, buddy en PO’er met testmailadressen.
Controleer achtereenvolgens:

1. code aanvragen en ontvangen;
2. verkeerde en verlopen code weigeren;
3. eigen profiel en klas tonen;
4. gegevens van andere testgebruikers afschermen;
5. Excel vergelijken en pas na twee bevestigingen verwerken;
6. klaswijziging en persoonlijke meldingen;
7. afzonderlijk en gezamenlijk markeren als gelezen;
8. uitloggen en opnieuw inloggen op een tweede apparaat.

## 5. Gecontroleerd live zetten

Pas na een volledig geslaagde test wordt in GitHub onder
**Settings > Secrets and variables > Actions > Variables** de waarde
`VITE_AUTH_ENABLED` gewijzigd van `false` naar `true`. Start daarna de workflow
**Publiceer Introweek-app** handmatig en controleer de live site.

## Directe terugval

Als inloggen of mailen niet goed werkt:

1. zet `VITE_AUTH_ENABLED` onmiddellijk terug op `false`;
2. start **Publiceer Introweek-app** opnieuw;
3. de lokale demo verschijnt weer, zonder databasegegevens te verwijderen;
4. onderzoek het probleem eerst met fictieve accounts.

De Supabase-URL en publishable key zijn openbare clientconfiguratie. SMTP-
wachtwoorden en service-role keys mogen nooit in GitHub-variabelen, broncode,
Excelbestanden of browseropslag worden geplaatst.
