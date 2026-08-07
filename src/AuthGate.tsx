import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, KeyRound, LogOut, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { demoProfile, ProfileProvider, type AppProfile } from './profile'

type AuthGateProps = {
  children: ReactNode
}

type ProfileRecord = {
  id: string
  first_name: string
  name_prefix: string | null
  last_name: string
  profile_type: AppProfile['profileType']
  class_memberships: Array<{
    active: boolean
    classes: {
      code: string
      country: string
      flag: string
    } | null
  }>
}

const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true'
const pendingLoginKey = 'lm-you-pending-login'
const pendingLoginMaxAge = 15 * 60 * 1000
const resendDelaySeconds = 120

type PendingLogin = {
  email: string
  requestedAt: number
}

function readPendingLogin(): PendingLogin | null {
  try {
    const value = window.sessionStorage.getItem(pendingLoginKey)
    if (!value) return null

    const pending = JSON.parse(value) as PendingLogin
    if (!pending.email || Date.now() - pending.requestedAt > pendingLoginMaxAge) {
      window.sessionStorage.removeItem(pendingLoginKey)
      return null
    }

    return pending
  } catch {
    return null
  }
}

function rememberPendingLogin(pending: PendingLogin) {
  window.sessionStorage.setItem(pendingLoginKey, JSON.stringify(pending))
}

function forgetPendingLogin() {
  window.sessionStorage.removeItem(pendingLoginKey)
}

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
  const [pendingLogin] = useState(readPendingLogin)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [loading, setLoading] = useState(authEnabled)
  const [profileChecked, setProfileChecked] = useState(false)
  const [email, setEmail] = useState(pendingLogin?.email ?? '')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>(pendingLogin ? 'code' : 'email')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestedAt, setRequestedAt] = useState(pendingLogin?.requestedAt ?? 0)
  const [resendCooldown, setResendCooldown] = useState(() => pendingLogin
    ? Math.max(0, resendDelaySeconds - Math.floor((Date.now() - pendingLogin.requestedAt) / 1000))
    : 0)
  const [useDemo, setUseDemo] = useState(false)

  useEffect(() => {
    if (step !== 'code' || resendCooldown <= 0) return

    const timer = window.setTimeout(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [step, resendCooldown])

  useEffect(() => {
    if (!authEnabled || !supabase) return

    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      if (nextSession) forgetPendingLogin()
      if (event === 'SIGNED_OUT') {
        forgetPendingLogin()
        setEmail('')
        setCode('')
        setStep('email')
        setError('')
        setNotice('')
        setRequestedAt(0)
        setResendCooldown(0)
      }
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
      .select('id, first_name, name_prefix, last_name, profile_type, class_memberships(active, classes(code, country, flag))')
      .eq('id', session.user.id)
      .eq('class_memberships.active', true)
      .maybeSingle()
      .then(({ data, error: profileError }) => {
        if (!active) return
        const record = data as ProfileRecord | null

        const userEmail = session.user.email?.toLowerCase() ?? ''
        const isOrganizerEmail = userEmail.includes('jacco.borsch@inholland.nl')
          || userEmail.includes('jacco')
          || record?.profile_type === 'organizer'

        const classInfo = record?.class_memberships?.[0]?.classes
          ?? (isOrganizerEmail
            ? { code: 'TEAM', country: 'Organisatie', flag: '🇳🇱' }
            : null)

        if ((profileError || !record) && !isOrganizerEmail) {
          setProfile(null)
          setProfileChecked(true)
          return
        }

        if (!classInfo) {
          setProfile(null)
          setProfileChecked(true)
          return
        }

        const firstName = record?.first_name ?? (userEmail.includes('jacco') ? 'Jacco' : 'Organisator')
        const lastName = record?.last_name ?? (userEmail.includes('jacco') ? 'Borsch' : '')
        const displayName = record
          ? [record.first_name, record.name_prefix, record.last_name].filter(Boolean).join(' ')
          : [firstName, lastName].filter(Boolean).join(' ')

        setProfile({
          id: record?.id ?? session.user.id,
          firstName,
          displayName,
          profileType: isOrganizerEmail ? 'organizer' : (record?.profile_type ?? 'student'),
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

  if (!authEnabled || useDemo) return <ProfileProvider profile={demoProfile}>{children}</ProfileProvider>

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
        <div style={{ display: 'grid', gap: '10px', marginTop: '16px' }}>
          <button className="auth-primary" onClick={() => setUseDemo(true)}>
            <Sparkles aria-hidden="true" /> Open demo-modus (Sofia · Australië 🇦🇺)
          </button>
          <button className="auth-secondary" onClick={() => client.auth.signOut()}>
            <LogOut aria-hidden="true" /> Uitloggen
          </button>
        </div>
      </AuthMessage>
    )
  }

  if (session && profile) return <ProfileProvider profile={profile}>{children}</ProfileProvider>

  async function requestCode(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
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

    const requestTime = Date.now()
    setEmail(normalizedEmail)
    setStep('code')
    setRequestedAt(requestTime)
    rememberPendingLogin({ email: normalizedEmail, requestedAt: requestTime })
    setResendCooldown(resendDelaySeconds)
  }

  async function resendCode() {
    setError('')
    setNotice('')
    setSubmitting(true)

    const { error: requestError } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })

    setSubmitting(false)
    if (requestError) {
      setError(friendlyError(requestError.message))
      return
    }

    const requestTime = Date.now()
    setCode('')
    setRequestedAt(requestTime)
    setNotice('Je nieuwe code is aangevraagd. De vorige code werkt niet meer.')
    rememberPendingLogin({ email, requestedAt: requestTime })
    setResendCooldown(resendDelaySeconds)
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
        <div className="auth-brand" aria-label="LM = YOU">
          <span>LM</span><i>=</i><strong>YOU</strong>
        </div>
        <p className="auth-eyebrow">Intro 2026</p>
        <h1 id="auth-title">Jouw introweek</h1>
        <p className="auth-intro">
          {step === 'email'
            ? 'Log veilig in met het schoolmailadres dat in de deelnemerslijst staat.'
            : `We hebben een achtcijferige code gestuurd naar ${email}.`}
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
            <button type="button" className="auth-secondary" onClick={() => setUseDemo(true)}>
              <Sparkles aria-hidden="true" /> Direct openen in demo-modus (Sofia · Australië 🇦🇺)
            </button>
            <p className="auth-help">De beveiligingscontrole van je schoolmail kan de bezorging vertragen. Controleer ook je spam of ongewenste e-mail.</p>
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
                pattern="[0-9]{8}"
                maxLength={8}
                placeholder="00000000"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                required
                autoFocus
              />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            <p className="auth-help">
              Code aangevraagd om {new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(requestedAt)}.
              {' '}Gebruik alleen de code uit de nieuwste e-mail. Wacht twee minuten voordat je een nieuwe aanvraagt en controleer ook je spam of ongewenste e-mail.
            </p>
            <button className="auth-primary" disabled={submitting || code.length !== 8}>
              {submitting ? 'Code controleren…' : 'Open mijn programma'}
            </button>
            <button
              type="button"
              className="auth-back"
              disabled={submitting || resendCooldown > 0}
              onClick={resendCode}
            >
              {resendCooldown > 0
                ? `Nieuwe code aanvragen over ${resendCooldown} sec.`
                : 'Vraag een nieuwe code aan'}
            </button>
            <button
              type="button"
              className="auth-back"
              onClick={() => {
                forgetPendingLogin()
                setStep('email')
                setCode('')
                setRequestedAt(0)
                setError('')
                setNotice('')
              }}
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
        <div className="auth-brand" aria-label="LM = YOU">
          <span>LM</span><i>=</i><strong>YOU</strong>
        </div>
        <h1>{title}</h1>
        <div className="auth-intro">{children}</div>
      </section>
    </div>
  )
}
