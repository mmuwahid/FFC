import { useParams } from 'react-router-dom'
import { StubPage } from '../components/StubPage'

export function RefEntry() {
  const { token } = useParams()
  return (
    <StubPage section="§3.4" title="Ref entry">
      Token: <code>{token ?? '(none)'}</code>
    </StubPage>
  )
}
