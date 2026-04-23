import { useNavigate } from 'react-router-dom'

export function Rules() {
  const navigate = useNavigate()

  return (
    <div className="page-container" style={{ padding: '0 16px 32px' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0' }}>
        <button
          onClick={() => navigate('/settings')}
          style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 20, cursor: 'pointer', padding: 0 }}
          aria-label="Back to Settings"
        >
          ‹
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>League Rules</h1>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Scoring
        </h2>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RuleRow label="Win" value="+3 pts" />
          <RuleRow label="Draw" value="+1 pt" />
          <RuleRow label="Loss" value="0 pts" />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Late cancellation
        </h2>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RuleRow label="Before roster lock" value="No penalty" />
          <RuleRow label="After lock (outside 24h)" value="−1 pt" />
          <RuleRow label="Within 24h of kickoff" value="−1 pt + 7-day ban" highlight />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          No-show
        </h2>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RuleRow label="On roster, didn't appear" value="−2 pts + 14-day ban" highlight />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Friendly games
        </h2>
        <div className="card" style={{ padding: '12px 16px' }}>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14, opacity: 0.85 }}>
            If 4 or more external players join a 7v7 matchday, or 3 or more join a 5v5, the match is automatically flagged as a friendly.
          </p>
          <p style={{ margin: '8px 0 0', lineHeight: 1.5, fontSize: 14, opacity: 0.85 }}>
            A confirmed friendly doesn't count toward the season table, player stats, or match history.
          </p>
        </div>
      </section>
    </div>
  )
}

function RuleRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 14, opacity: 0.85 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: highlight ? 'var(--color-red, #e53935)' : 'inherit' }}>
        {value}
      </span>
    </div>
  )
}
