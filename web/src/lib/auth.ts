import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Me } from '@/lib/types'

/** The signed-in user, or null when there is no session. */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await api<Me>('/api/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
  })
}

const notMe = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'me'

/**
 * Switching user must refetch everything the old user saw, but NOT drop the 'me' query itself: clearing the whole
 * cache orphans live observers, and the header would keep showing the previous user.
 */
function adopt(qc: QueryClient, me: Me) {
  qc.setQueryData(['me'], me)
  void qc.resetQueries({ predicate: notMe })
}

export function useAuthActions() {
  const qc = useQueryClient()
  return {
    login: async (username: string, password: string) => {
      const me = await api<Me>('/api/auth/login', { method: 'POST', body: { username, password } })
      adopt(qc, me)
      return me
    },
    logout: async () => {
      await api<void>('/api/auth/logout', { method: 'POST' })
      qc.removeQueries({ predicate: notMe })      // pages unmount on redirect; do not refetch as an anonymous user
      qc.setQueryData(['me'], null)
    },
    switchRole: async (role: string) => {
      const me = await api<Me>('/api/auth/switch-role', { method: 'POST', body: { role } })
      adopt(qc, me)
      return me
    },
  }
}

/** Saves language / onboarding choices on the server and adopts the returned profile. */
export function useSavePrefs() {
  const qc = useQueryClient()
  return async (prefs: { language?: string; onboarded?: boolean; onboardingSkipped?: boolean }) => {
    const me = await api<Me>('/api/me/prefs', { method: 'PUT', body: prefs })
    qc.setQueryData(['me'], me)
    return me
  }
}
