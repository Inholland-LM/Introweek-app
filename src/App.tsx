import { useState } from 'react'
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Clock3,
  Ellipsis,
  Map,
  MapPin,
  Navigation,
  Trophy,
} from 'lucide-react'
import { mapUrl, today } from './data'

const navItems = [
  { label: 'Vandaag', icon: Clock3 },
  { label: 'Programma', icon: CalendarDays },
  { label: 'Kaart', icon: Map },
  { label: 'Strijd', icon: Trophy },
  { label: 'Meer', icon: Ellipsis },
] as const

function App() {
  const [active, setActive] = useState<(typeof navItems)[number]['label']>('Vandaag')

  return (
    <div className="app-shell">
      <div className="map-texture" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">Introweek LM 2026</div>
        <div className="identity-row">
          <div className="identity">
            <span className="flag" aria-label="Vlag van Australië">🇦🇺</span>
            <span>LM1A · Australië</span>
          </div>
          <button className="icon-button notification" aria-label="Meldingen openen">
            <Bell aria-hidden="true" />
            <span className="notification-dot" />
          </button>
        </div>
      </header>

      <main>
        {active === 'Vandaag' ? (
          <>
            <section className="welcome" aria-labelledby="welcome-title">
              <p className="eyebrow">Introdag 2 · woensdag 26 augustus</p>
              <h1 id="welcome-title">Goedemorgen, Sofia</h1>
              <p className="welcome-copy">Alles wat je vandaag nodig hebt, staat hier voor je klaar.</p>
            </section>

            <section className="next-card" aria-labelledby="next-title">
              <div className="card-kicker"><span>★</span> Volgende</div>
              <h2 id="next-title">Het Amsterdams Geluid</h2>
              <div className="next-details">
                <div className="detail-row"><Clock3 aria-hidden="true" /><strong>11:45</strong></div>
                <div className="detail-row"><MapPin aria-hidden="true" /><span>De Duif</span></div>
                <div className="detail-row countdown"><Navigation aria-hidden="true" /><span>Vertrek over 18 minuten</span></div>
              </div>
              <a className="primary-button" href={mapUrl} target="_blank" rel="noreferrer">
                <span>Open route</span><ChevronRight aria-hidden="true" />
              </a>
            </section>

            <section className="timeline-section" aria-labelledby="today-title">
              <div className="section-heading">
                <h2 id="today-title">Vandaag</h2>
                <span>Jouw programma</span>
              </div>
              <ol className="timeline">
                {today.map((item) => (
                  <li key={`${item.time}-${item.title}`} className={item.state}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div className="timeline-card">
                      <time>{item.time}</time>
                      <div>
                        <strong>{item.title}</strong>
                        {item.location && <small>{item.location}</small>}
                      </div>
                      <ChevronRight aria-hidden="true" />
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <button className="standings-card" onClick={() => setActive('Strijd')}>
              <span className="rank-medallion"><span aria-hidden="true">🇦🇺</span><b>2</b></span>
              <span className="standings-copy"><strong>Landenstrijd</strong><span>Australië staat <b>2e</b> · <b>180</b> punten</span></span>
              <ChevronRight aria-hidden="true" />
            </button>
          </>
        ) : (
          <section className="placeholder-view" aria-live="polite">
            <span className="placeholder-icon" aria-hidden="true">
              {active === 'Programma' && <CalendarDays />}
              {active === 'Kaart' && <Map />}
              {active === 'Strijd' && <Trophy />}
              {active === 'Meer' && <Ellipsis />}
            </span>
            <p className="eyebrow">Binnenkort beschikbaar</p>
            <h1>{active}</h1>
            <p>Dit onderdeel krijgt in de volgende bouwstap zijn volledige inhoud.</p>
            <button className="secondary-button" onClick={() => setActive('Vandaag')}>Terug naar vandaag</button>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Hoofdnavigatie">
        {navItems.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={active === label ? 'active' : ''}
            onClick={() => setActive(label)}
            aria-current={active === label ? 'page' : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
