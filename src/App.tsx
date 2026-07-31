import { useState } from 'react'
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Clock3,
  Ellipsis,
  LocateFixed,
  Map,
  MapPin,
  Navigation,
  Trophy,
} from 'lucide-react'
import { mapUrl, programmeDays, routeDays, today, type ProgrammeDay, type RouteDay } from './data'

const navItems = [
  { label: 'Vandaag', icon: Clock3 },
  { label: 'Programma', icon: CalendarDays },
  { label: 'Kaart', icon: Map },
  { label: 'Strijd', icon: Trophy },
  { label: 'Meer', icon: Ellipsis },
] as const

type NavLabel = (typeof navItems)[number]['label']

function ProgrammeView() {
  const [selectedDayId, setSelectedDayId] = useState<ProgrammeDay['id']>('woensdag')
  const selectedDay = programmeDays.find((day) => day.id === selectedDayId) ?? programmeDays[1]

  return (
    <section className="programme-view" aria-labelledby="programme-title">
      <div className="page-intro">
        <p className="eyebrow">Persoonlijk voor LM1A</p>
        <h1 id="programme-title">Jouw programma</h1>
        <p>Alle tijden, locaties en routes voor jouw klas overzichtelijk bij elkaar.</p>
      </div>

      <div className="day-switcher" role="tablist" aria-label="Kies een introductiedag">
        {programmeDays.map((day) => (
          <button
            key={day.id}
            role="tab"
            aria-selected={selectedDay.id === day.id}
            className={selectedDay.id === day.id ? 'active' : ''}
            onClick={() => setSelectedDayId(day.id)}
          >
            <span>{day.shortLabel}</span>
            <small>aug</small>
          </button>
        ))}
      </div>

      <article className="day-overview">
        <div className="day-overview-heading">
          <div>
            <p>{selectedDay.date}</p>
            <h2>{selectedDay.title}</h2>
          </div>
          <CalendarDays aria-hidden="true" />
        </div>
        <p>{selectedDay.summary}</p>
      </article>

      <ol className="programme-list">
        {selectedDay.items.map((item) => (
          <li key={`${selectedDay.id}-${item.time}-${item.title}`}>
            <time>{item.time}</time>
            <div className="programme-activity">
              <span className="activity-category">{item.category}</span>
              <h3>{item.title}</h3>
              {item.location && (
                <p><MapPin aria-hidden="true" />{item.location}</p>
              )}
              {item.routeUrl && (
                <a href={item.routeUrl} target="_blank" rel="noreferrer">
                  <Navigation aria-hidden="true" /> Route openen
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="programme-note">Wijzigt er iets? Dan verschijnt de actuele informatie automatisch bovenaan.</p>
    </section>
  )
}

function MapView() {
  const [selectedDayId, setSelectedDayId] = useState<RouteDay['id']>('woensdag')
  const selectedDay = routeDays.find((day) => day.id === selectedDayId) ?? routeDays[1]

  return (
    <section className="map-view" aria-labelledby="map-title">
      <div className="page-intro">
        <p className="eyebrow">Jouw locaties</p>
        <h1 id="map-title">Op pad in Amsterdam</h1>
        <p>Bekijk je route zonder zware online kaart. Open Google Maps alleen wanneer je echt wilt navigeren.</p>
      </div>

      <div className="day-switcher" role="tablist" aria-label="Kies een route per dag">
        {routeDays.map((day) => (
          <button
            key={day.id}
            role="tab"
            aria-selected={selectedDay.id === day.id}
            className={selectedDay.id === day.id ? 'active' : ''}
            onClick={() => setSelectedDayId(day.id)}
          >
            <span>{day.shortLabel}</span>
            <small>aug</small>
          </button>
        ))}
      </div>

      <div className="route-canvas" aria-label={`Schematische route voor ${selectedDay.shortLabel}`}>
        <div className="route-grid" aria-hidden="true" />
        <div className="route-water" aria-hidden="true" />
        <span className="route-city-label" aria-hidden="true">AMSTERDAM</span>
        {selectedDay.stops.map((stop) => (
          <span
            key={`${selectedDay.id}-${stop.number}`}
            className="map-marker"
            style={{ left: stop.x, top: stop.y }}
            aria-hidden="true"
          >
            <b>{stop.number}</b>
          </span>
        ))}
      </div>

      <div className="route-heading">
        <div>
          <p className="eyebrow">Jouw route</p>
          <h2>{selectedDay.label}</h2>
        </div>
        <LocateFixed aria-hidden="true" />
      </div>

      <ol className="route-list">
        {selectedDay.stops.map((stop) => (
          <li key={`${selectedDay.id}-${stop.number}-${stop.title}`}>
            <span className="route-number">{stop.number}</span>
            <div className="route-stop-copy">
              <time>{stop.time}</time>
              <h3>{stop.title}</h3>
              <p>{stop.address}</p>
            </div>
            <a href={stop.routeUrl} target="_blank" rel="noreferrer" aria-label={`Route naar ${stop.title} openen`}>
              <Navigation aria-hidden="true" />
            </a>
          </li>
        ))}
      </ol>

      <p className="programme-note">De schematische kaart gebruikt geen mobiele data. Alleen ‘Route openen’ start Google Maps.</p>
    </section>
  )
}

function PlaceholderView({ active, onBack }: { active: Exclude<NavLabel, 'Vandaag' | 'Programma' | 'Kaart'>; onBack: () => void }) {
  return (
    <section className="placeholder-view" aria-live="polite">
      <span className="placeholder-icon" aria-hidden="true">
        {active === 'Strijd' && <Trophy />}
        {active === 'Meer' && <Ellipsis />}
      </span>
      <p className="eyebrow">Binnenkort beschikbaar</p>
      <h1>{active}</h1>
      <p>Dit onderdeel krijgt in de volgende bouwstap zijn volledige inhoud.</p>
      <button className="secondary-button" onClick={onBack}>Terug naar vandaag</button>
    </section>
  )
}

function App() {
  const [active, setActive] = useState<NavLabel>('Vandaag')

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
        {active === 'Vandaag' && (
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
        )}

        {active === 'Programma' && <ProgrammeView />}

        {active === 'Kaart' && <MapView />}

        {active !== 'Vandaag' && active !== 'Programma' && active !== 'Kaart' && (
          <PlaceholderView active={active} onBack={() => setActive('Vandaag')} />
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
