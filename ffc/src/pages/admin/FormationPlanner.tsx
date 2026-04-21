import { useParams } from 'react-router-dom'
import { StubPage } from '../../components/StubPage'

export function FormationPlanner() {
  const { id } = useParams()
  return (
    <StubPage section="§3.19" title={`Formation — match ${id ?? ''}`.trim()}>
      Captain-only planner. 7 patterns, rotating GK, drag-drop tokens, realtime sync.
    </StubPage>
  )
}
