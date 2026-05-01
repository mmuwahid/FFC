import type { Database } from './database.types'

export type ThemePreference = Database['public']['Enums']['theme_preference']

export function applyThemeClass(theme: ThemePreference): void {
  const root = document.documentElement
  root.classList.remove('theme-light', 'theme-dark', 'theme-auto')
  if (theme === 'light') root.classList.add('theme-light')
  else if (theme === 'system') root.classList.add('theme-auto')
  // 'dark' is the CSS default — no class needed
}
