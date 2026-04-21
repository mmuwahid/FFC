import { useParams } from 'react-router-dom'
import { StubPage } from '../components/StubPage'

export function MatchDetail() {
  const { id } = useParams()
  return (
    <StubPage section="§3.15" title={`Match ${id ?? ''}`.trim()}>
      Per-match scoreline, lineups, events, W/D/L from profile-owner perspective.
    </StubPage>
  )
}
