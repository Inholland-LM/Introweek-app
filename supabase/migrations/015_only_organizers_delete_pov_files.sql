-- Ook een uploader mag een eenmaal gereserveerd POV-bestand niet zelf wissen.
-- Alle verwijdering loopt via de beveiligde organisatoractie.
drop policy if exists "POV eigen tijdelijk bestand verwijderen" on storage.objects;
