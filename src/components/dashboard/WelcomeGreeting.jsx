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
          fontSize: 'clamp(24px, 2vw, 32px)',
          lineHeight: 1.15,
          fontWeight: 700,
          letterSpacing: '-0.025em',
          color: 'var(--c-text1)',
        }}
      >
        {greeting}, <span className="ft-greet-name">{name}</span>{' '}
        <span className="ft-greet-wave" role="img" aria-label="waving hand">👋</span>
      </h1>
      <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--c-text3)' }}>
        Let&rsquo;s take a look at your fleet&rsquo;s progress
      </p>
      {/* Its own line, as the client asked, so it reads as the day's heading. */}
      <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--c-text2)', fontWeight: 500 }}>
        {today}
      </p>
    </div>
  )
}
