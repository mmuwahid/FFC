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
          <div className="lr-scoring">
            <div className="lr-scoring-cell">
              <div className="lr-scoring-label">Win</div>
              <div className="lr-scoring-value">3 pts</div>
            </div>
            <div className="lr-scoring-cell">
              <div className="lr-scoring-label">Draw</div>
              <div className="lr-scoring-value">1 pt</div>
            </div>
            <div className="lr-scoring-cell">
              <div className="lr-scoring-label">Loss</div>
              <div className="lr-scoring-value">0 pts</div>
            </div>
          </div>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">Dropping out</div>
          <table className="lr-table">
            <thead>
              <tr><th>Timing</th><th>Penalty</th></tr>
            </thead>
            <tbody>
              <tr><td>Before captains announced</td><td>No penalty</td></tr>
              <tr><td>After captains announced (roster locked)</td><td>−1 pt</td></tr>
              <tr><td>During captain selection / after teams picked</td><td>−1 pt + 1-week ban</td></tr>
              <tr><td>Within 24h of match / match day</td><td>−2 pts + 1-week ban</td></tr>
              <tr><td>No-show (rostered, didn't appear)</td><td>−2 pts + 2-week ban</td></tr>
            </tbody>
          </table>
          <div className="lr-note">If you drop out, please remove your name from the list.</div>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">Kick-off</div>
          <div className="lr-prose">
            Kick-off is at <strong>8:15 pm</strong>. Full-time at <strong>9:30 pm</strong>.
          </div>
          <table className="lr-table">
            <thead>
              <tr><th>Arrival</th><th>Penalty</th></tr>
            </thead>
            <tbody>
              <tr><td>8:15 – 8:29 pm (late)</td><td>−1 pt + 1-week ban</td></tr>
              <tr><td>8:30 pm or later / no-show</td><td>−2 pts + 2-week ban</td></tr>
            </tbody>
          </table>
          <div className="lr-note">Applies regardless of the waiting list.</div>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">Cards</div>
          <table className="lr-table">
            <thead>
              <tr><th>Card</th><th>Consequence</th></tr>
            </thead>
            <tbody>
              <tr><td>1st yellow</td><td>Warning</td></tr>
              <tr><td>2nd yellow</td><td>5-min sin-bin + −1 pt + 1-week ban</td></tr>
              <tr><td>Straight red</td><td>5-min sin-bin + −2 pts + 1-week ban</td></tr>
            </tbody>
          </table>
        </div>

        <div className="lr-card">
          <div className="lr-card-header">Awards</div>
          <ul className="lr-award-list">
            <li className="lr-award-item"><span className="lr-award-name">Championship</span><span className="lr-award-sub">1st place</span></li>
            <li className="lr-award-item"><span className="lr-award-name">Runner-up</span><span className="lr-award-sub">2nd place</span></li>
            <li className="lr-award-item"><span className="lr-award-name">3rd place</span><span className="lr-award-sub">bronze</span></li>
            <li className="lr-award-item"><span className="lr-award-name">Top Scorer</span><span className="lr-award-sub">most goals</span></li>
            <li className="lr-award-item"><span className="lr-award-name">Best Win %</span><span className="lr-award-sub">min 40% of matches played</span></li>
            <li className="lr-award-item"><span className="lr-award-name">Best Attendance</span><span className="lr-award-sub">highest participation rate</span></li>
            <li className="lr-award-item"><span className="lr-award-name">Ballon d'Or</span><span className="lr-award-sub">most MOTMs</span></li>
            <li className="lr-award-item"><span className="lr-award-name">Best Captain</span><span className="lr-award-sub">longest captain win streak</span></li>
          </ul>
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
