import { RouterProvider } from 'react-router-dom'
import { AppProvider } from './lib/AppContext'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { router } from './router'

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ErrorBoundary>
  )
}
