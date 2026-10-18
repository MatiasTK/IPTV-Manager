import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HealthStatusResponse, HealthChannel, DuplicatesResponse } from '@/lib/types'

export function useHealthStatus() {
  return useQuery({
    queryKey: ['health', 'status'],
    queryFn: () => api.get<HealthStatusResponse>('/api/health/status'),
    staleTime: 0,
    refetchInterval: (query) => {
      return query.state.data?.isChecking ? 1500 : 30000
    },
  })
}

export function useHealthChannels() {
  return useQuery({
    queryKey: ['health', 'channels'],
    queryFn: () => api.get<{ channels: HealthChannel[] }>('/api/health/channels'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useCheckNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sourceId: number | void) => api.post('/api/health/check-now', sourceId ? { sourceId } : undefined),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['health'] })
        qc.invalidateQueries({ queryKey: ['channels'] })
      }, 3000)
    },
  })
}

export function useCancelCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/health/cancel'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health'] }),
  })
}

export function useDuplicates(threshold: number, opts: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({
    queryKey: ['duplicates', threshold],
    queryFn: () => api.get<DuplicatesResponse>(`/api/channels/duplicates?threshold=${threshold}`),
    staleTime: opts.staleTime ?? 0,
    enabled: opts.enabled ?? true,
  })
}
