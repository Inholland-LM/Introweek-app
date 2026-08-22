-- Nu de toestemmingsbewuste client live staat, mag de oude uploadafronding
-- zonder afzonderlijk geregistreerde bevestiging niet meer worden aangeroepen.

revoke all on function public.complete_pov_upload(uuid, text, text, integer, text)
  from public, anon, authenticated;

comment on function public.complete_pov_upload(uuid, text, text, integer, text) is
  'Verouderde uploadafronding zonder toestemmingsaudit; niet meer uitvoerbaar door app-rollen.';
