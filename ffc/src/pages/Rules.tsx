import { useNavigate } from 'react-router-dom'

/* §3.16 League Rules — static reference screen at /settings/rules.
 * No DB query. Content matches app_settings keys and spec §5 penalty table. */
export function Rules() {
  const navigate = useNavigate()

  return (
    <div>
      <div className="lr-nav">
        <button className="lr-back-btn" aria-label="Back" onClick={() => navigate('/settings')}>←</button>
        <span className="lr-title">League Rules</span>
      </div>

      <div className="lr-screen">

        <div className="lr-card">
          <div className="lr-card-header">Scoring</div>
          <table className="lr-table">
            <thead>
              <tr><th>Result</th><th>Points</th></tr>
            </thead>
            <tbody>
              <tr><td>Win</td><td>3 pts</td></tr>
              <tr><td>Draw</td><td>1 pt</td></tr>
              <tr><td>Loss</td><td>0 pts</td></tr>
            </tbody>
          </table>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">Late cancellation</div>
          <table className="lr-table">
            <thead>
              <tr><th>Timing</th><th>Penalty</th></tr>
            </thead>
            <tbody>
              <tr><td>Before roster lock</td><td>No penalty</td></tr>
              <tr><td>After lock, outside 24h of kickoff</td><td>−1 pt</td></tr>
              <tr><td>Within 24h of kickoff</td><td>−1 pt + 7-day ban</td></tr>
            </tbody>
          </table>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">No-show</div>
          <table className="lr-table">
            <thead>
              <tr><th>Situation</th><th>Penalty</th></tr>
            </thead>
            <tbody>
              <tr><td>Rostered, didn't appear</td><td>−2 pts + 14-day ban</td></tr>
            </tbody>
          </table>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">Friendly games</div>
          <div className="lr-prose">
            If 4 or more external players join a 7v7 matchday, or 3 or more join a 5v5,
            the match is flagged as a friendly. A friendly game doesn't count toward the
            season table, player stats, or match history.
          </div>
        </div>

      </div>
    </div>
  )
}
