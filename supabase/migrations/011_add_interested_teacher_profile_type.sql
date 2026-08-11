-- Introweek-app: voeg de profielrol voor geïnteresseerde docenten toe.
--
-- Deze enumwijziging staat bewust in een afzonderlijke migratie. PostgreSQL
-- moet de nieuwe enumwaarde eerst vastleggen voordat functies en constraints
-- haar in een volgende transactie kunnen gebruiken.

alter type public.profile_type
  add value if not exists 'interested_teacher' after 'poer';

