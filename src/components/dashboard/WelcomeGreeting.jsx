// Personalised greeting that heads the dashboard. The name comes from the
// signed-in profile (services/authUser), never from a literal.
import { useEffect, useState } from 'react'
import { useCurrentUser, firstName, greetingFor } from '../../services/authUser'

const DATE_FMT = { weekday: 'long', month: 'long', day: 'numeric' }

export default function WelcomeGreeting() {
  const user = useCurrentUser()
  const name = firstName(user)

  // Re-evaluates on the minute so a session left open overnight doesn't keep
  // saying "Good evening" at breakfast.
  const [greeting, setGreeting] = useState(() => greetingFor())
  useEffect(() => {
    const id = setInterval(() => setGreeting(greetingFor()), 60_000)
    return () => clearInterval(id)
  }, [])

  const today = new Date().toLocaleDateString('en-US', DATE_FMT)

  return (
    <div style={{ minWidth: 0 }}>
      <h1
        style={{
          margin: 0,
          fontSize: 'clamp(19px, 1.5vw, 26px)',
          lineHeight: 1.2,
          fontWeight: 700,
          letterSpacing: '-0.025em',
          color: 'var(--c-text1)',
        }}
      >
        {greeting}, <span className="ft-greet-name">{name}</span>{' '}
        <span className="ft-greet-wave" role="img" aria-label="waving hand">👋</span>
      </h1>
      <p
        style={{
          margin: '4px 0 0',
          fontSize: 12.5,
          color: 'var(--c-text3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        Here&rsquo;s your fleet overview for today
        {/* The date is supporting detail — dropped on narrow screens rather
            than wrapped onto its own line under a dangling separator. */}
        <span aria-hidden="true" className="hidden sm:inline-block" style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--c-border2)' }} />
        <span className="hidden sm:inline" style={{ color: 'var(--c-text2)', fontWeight: 500 }}>{today}</span>
      </p>
    </div>
  )
}
