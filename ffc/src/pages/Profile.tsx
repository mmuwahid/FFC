import { useParams } from 'react-router-dom'
import { StubPage } from '../components/StubPage'

export function Profile() {
  const { id } = useParams()
  return (
    <StubPage section="§3.14" title={id ? `Player ${id}` : 'Your profile'}>
      KPIs, achievements, match history.
    </StubPage>
  )
}
