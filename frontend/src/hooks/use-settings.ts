import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Settings } from '@/lib/types'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: 60_000,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Omit<Settings, 'playlist_token'>>) =>
      api.put<Settings>('/api/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useRegenerateToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ token: string }>('/api/settings/regenerate-token'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}
