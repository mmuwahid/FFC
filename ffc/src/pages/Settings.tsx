// ffc/src/pages/Settings.tsx
import { useNavigate } from 'react-router-dom'

export function Settings() {
  const navigate = useNavigate()

  return (
    <div className="page-container" style={{ padding: '16px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          General
        </h2>
        <div className="card" style={{ padding: 0 }}>
          <button
            onClick={() => navigate('/settings/rules')}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '14px 16px', background: 'none', border: 'none',
              color: 'inherit', fontSize: 15, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span>League Rules</span>
            <span style={{ opacity: 0.4 }}>›</span>
          </button>
        </div>
      </section>

      <p style={{ opacity: 0.4, fontSize: 13, textAlign: 'center' }}>
        §3.16 full settings screen coming soon
      </p>
    </div>
  )
}
