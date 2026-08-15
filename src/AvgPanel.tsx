import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { fetchMyImageConsent, saveMyImageConsent, type ImageConsent } from './privacyConsent'

export function AvgPanel() {
  const [choice, setChoice] = useState<ImageConsent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchMyImageConsent().then(setChoice).catch(() => setMessage('Je huidige keuze kon niet worden opgehaald.')).finally(() => setLoading(false))
  }, [])

  async function choose(consent: boolean) {
    setSaving(true); setMessage('')
    try {
      setChoice(await saveMyImageConsent(consent))
      setMessage(consent ? 'Je toestemming is vastgelegd.' : 'Je keuze om geen toestemming te geven is vastgelegd.')
    } catch {
      setMessage('Je keuze kon niet worden opgeslagen. Probeer het opnieuw.')
    } finally { setSaving(false) }
  }

  return <>
    <div className="more-panel-heading"><div><p className="eyebrow">JOUW PRIVACY</p><h2>AVG &amp; beeldgebruik</h2></div><ShieldCheck aria-hidden="true" /></div>
    <div className="avg-panel-copy">
      <p>Tijdens de introweek kunnen foto’s en video’s worden gemaakt waarop je herkenbaar bent. De organisatie gebruikt herkenbaar beeld alleen voor verslaglegging en communicatie over de introweek en LM = YOU.</p>
      <ul>
        <li>Toestemming is vrijwillig. Niet akkoord gaan heeft geen gevolgen voor jouw deelname.</li>
        <li>Goedgekeurde POV-inzendingen zijn zichtbaar voor de eigen klas en de organisatie; openbaar gebruik gebeurt niet op basis van deze keuze alleen.</li>
        <li>Je kunt jouw keuze hier op ieder moment wijzigen. Na intrekken wordt beeld niet meer voor nieuw gebruik ingezet; neem voor verwijdering van bestaand beeld contact op met de organisatie.</li>
        <li>De app verwerkt daarnaast alleen gegevens die nodig zijn voor jouw programma, klas, meldingen en deelname. Gegevens worden niet langer bewaard dan nodig voor organisatie, verantwoording en afhandeling van de introweek.</li>
        <li>Je kunt vragen om inzage, correctie of verwijdering en je kunt een klacht indienen bij de Autoriteit Persoonsgegevens.</li>
      </ul>
    </div>
    <fieldset className="avg-choice" disabled={loading || saving}>
      <legend>Mag de organisatie herkenbare beeldopnames van mij gebruiken voor verslaglegging en communicatie over de introweek en LM = YOU?</legend>
      <button type="button" className={choice?.consent === true ? 'selected' : ''} onClick={() => void choose(true)}>Ja, ik geef toestemming</button>
      <button type="button" className={choice?.consent === false ? 'selected' : ''} onClick={() => void choose(false)}>Nee, ik geef geen toestemming</button>
    </fieldset>
    {loading && <p className="notification-state"><LoaderCircle className="spin" /> Keuze ophalen…</p>}
    {message && <p className="avg-message"><CheckCircle2 aria-hidden="true" /> {message}</p>}
    {choice && <p className="panel-footnote">Laatst vastgelegd op {new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(choice.updatedAt))}.</p>}
  </>
}
