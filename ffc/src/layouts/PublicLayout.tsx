import { Outlet } from 'react-router-dom'

/* Anonymous shell: welcome / login / signup / pending-approval.
 * No topbar (auth screens already render their own centred FFC crest, so the
 * `3573761` topbar header was redundant on these routes — stripped at S038).
 * No bottom nav, no admin chrome. */
export function PublicLayout() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
