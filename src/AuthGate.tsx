import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, KeyRound, LogOut, Mail, ShieldCheck } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { demoProfile, ProfileProvider, type AppProfile } from './profile'

type AuthGateProps = {
  children: ReactNode
}

type ProfileRecord = {
  first_name: string
  name_prefix: string | null
  last_name: string
  profile_type: AppProfile['profileType']
  class_memberships: Array<{
    classes: {
      code: string
      country: string
      flag: string
    } | null
  }>
}

const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true'

function friendlyError(message: string) {
  if (message.toLowerCase().includes('rate limit')) {
    return 'Er zijn te veel codes aangevraagd. Wacht even en probeer het daarna opnieuw.'
  }

  if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('expired')) {
    return 'Deze code is onjuist of verlopen. Vraag eventueel een nieuwe code aan.'
  }

  return 'Inloggen lukt nu niet. Controleer je schoolmailadres of probeer het later opnieuw.'
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [loading, setLoading] = useState(authEnabled)
  const [profileChecked, setProfileChecked] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!authEnabled || !supabase) return

    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setProfile(null)
      setProfileChecked(false)
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authEnabled || !supabase || !session) return

    let active = true
    setProfileChecked(false)

    supabase
      .from('profiles')
      .select('first_name, name_prefix, last_name, profile_type, class_memberships(classes(code, country, flag))')
      .maybeSingle()
      .then(({ data, error: profileError }) => {
        if (!active) return
        const record = data as ProfileRecord | null
        const classInfo = record?.class_memberships?.[0]?.classes
          ?? (record?.profile_type === 'organizer'
            ? { code: 'ORGA', country: 'Organisatie', flag: '🎓' }
            : null)

        if (profileError || !record || !classInfo) {
          setProfile(null)
          setProfileChecked(true)
          return
        }

        const displayName = [record.first_name, record.name_prefix, record.last_name].filter(Boolean).join(' ')
        setProfile({
          firstName: record.first_name,
          displayName,
          profileType: record.profile_type,
          classCode: classInfo.code,
          country: classInfo.country,
          flag: classInfo.flag,
        })
        setProfileChecked(true)
      })

    return () => {
      active = false
    }
  }, [session])

  if (!authEnabled) return <ProfileProvider profile={demoProfile}>{children}</ProfileProvider>

  if (!isSupabaseConfigured || !supabase) {
    return (
      <AuthMessage title="De app wordt voorbereid">
        De beveiligde verbinding is nog niet geconfigureerd. Probeer het later opnieuw.
      </AuthMessage>
    )
  }

  const client = supabase

  if (loading || (session && !profileChecked)) {
    return (
      <AuthMessage title="Jouw programma ophalen">
        Een ogenblik, we laden je persoonlijke introweek.
      </AuthMessage>
    )
  }

  if (session && !profile) {
    return (
      <AuthMessage title="Nog geen toegang">
        Je bent ingelogd, maar je schoolmailadres staat nog niet in de deelnemerslijst.
        <button className="auth-secondary" onClick={() => client.auth.signOut()}>
          <LogOut aria-hidden="true" /> Uitloggen
        </button>
      </AuthMessage>
    )
  }

  if (session && profile) return <ProfileProvider profile={profile}>{children}</ProfileProvider>

  async function requestCode(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const normalizedEmail = email.trim().toLowerCase()
    const { error: requestError } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false },
    })

    setSubmitting(false)
    if (requestError) {
      setError(friendlyError(requestError.message))
      return
    }

    setEmail(normalizedEmail)
    setStep('code')
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const { error: verifyError } = await client.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    })

    setSubmitting(false)
    if (verifyError) setError(friendlyError(verifyError.message))
  }

  return (
    <div className="auth-shell">
      <div className="auth-map" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-seal"><ShieldCheck aria-hidden="true" /></div>
        <div className="auth-brand" aria-label="LM Amsterdam">
          <span>LM</span><i>=</i><strong>AMSTERDAM</strong>
        </div>
        <p className="auth-eyebrow">Intro 2026</p>
        <h1 id="auth-title">Jouw introweek</h1>
        <p className="auth-intro">
          {step === 'email'
            ? 'Log veilig in met het schoolmailadres dat in de deelnemerslijst staat.'
            : `We hebben een zescijferige code gestuurd naar ${email}.`}
        </p>

        {step === 'email' ? (
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="school-email">Schoolmailadres</label>
            <div className="auth-input">
              <Mail aria-hidden="true" />
              <input
                id="school-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="naam@inholland.nl"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-primary" disabled={submitting}>
              {submitting ? 'Code aanvragen…' : 'Stuur mij een inlogcode'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <label htmlFor="login-code">Inlogcode</label>
            <div className="auth-input auth-code-input">
              <KeyRound aria-hidden="true" />
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
              />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-primary" disabled={submitting || code.length !== 6}>
              {submitting ? 'Code controleren…' : 'Open mijn programma'}
            </button>
            <button
              type="button"
              className="auth-back"
              onClick={() => { setStep('email'); setCode(''); setError('') }}
            >
              <ArrowLeft aria-hidden="true" /> Ander mailadres gebruiken
            </button>
          </form>
        )}

        <p className="auth-footnote">Geen wachtwoord nodig · jouw gegevens blijven afgeschermd</p>
      </section>
    </div>
  )
}

function AuthMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-shell">
      <section className="auth-card auth-message" aria-live="polite">
        <div className="auth-seal"><ShieldCheck aria-hidden="true" /></div>
        <div className="auth-brand" aria-label="LM Amsterdam">
          <span>LM</span><i>=</i><strong>AMSTERDAM</strong>
        </div>
        <h1>{title}</h1>
        <div className="auth-intro">{children}</div>
      </section>
    </div>
  )
}
