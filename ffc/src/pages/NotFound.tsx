import { Link } from 'react-router-dom'
import { StubPage } from '../components/StubPage'

export function NotFound() {
  return (
    <StubPage section="404" title="Page not found">
      <p>The route you tried doesn&rsquo;t exist.</p>
      <p style={{ marginTop: 8 }}>
        <Link to="/">Back home</Link>
      </p>
    </StubPage>
  )
}
