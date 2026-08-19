# Publicatieregel

## Eén bron, twee adressen

- `Inholland-LM/Introweek-app` op `main` is de enige broncode.
- Een wijzigingsverzoek dat op een van beide adressen wordt geconstateerd, wordt altijd in deze bronrepository uitgevoerd.
- Iedere geslaagde wijziging wordt gepubliceerd naar:
  - https://lmyou.nl/
  - https://inholland-lm.github.io/introweek-test/
- Bewerk de gegenereerde `gh-pages`-branch van `Inholland-LM/introweek-test` nooit handmatig.
- Wacht na een merge naar `main` eerst op de workflow `Publiceer Introweek-app`.
- Start daarna direct de workflow `Publiceer actuele Introweek-app` in `Inholland-LM/introweek-test` en wacht ook op de daaropvolgende Pages-deployment.
- Controleer dat `source-version.txt` in de mirror exact gelijk is aan de commit-SHA van `Introweek-app/main`.
- Rapporteer een wijziging pas als live nadat beide publicaties zijn geslaagd.
- Beide adressen gebruiken dezelfde Supabase-backend en configuratie. Verander deze koppeling niet zonder expliciete toestemming.
