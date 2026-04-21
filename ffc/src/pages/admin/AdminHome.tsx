import { Link } from 'react-router-dom'
import { StubPage } from '../../components/StubPage'

export function AdminHome() {
  return (
    <StubPage section="Admin" title="Admin console">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <Link to="/admin/players">Players (§3.17)</Link>
        <Link to="/admin/matches">Matches (§3.18)</Link>
      </div>
    </StubPage>
  )
}
