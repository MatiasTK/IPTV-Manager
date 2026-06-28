import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HealthStatusResponse, HealthChannel, DuplicatesResponse } from '@/lib/types'

export function useHealthStatus() {
  return useQuery({
    queryKey: ['health', 'status'],
    queryFn: () => api.get<HealthStatusResponse>('/api/health/status'),
    staleTime: 15_000,
    refetchInterval: 30_000,
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
    mutationFn: () => api.post('/api/health/check-now'),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['health'] })
        qc.invalidateQueries({ queryKey: ['channels'] })
      }, 3000)
    },
  })
}

export function useDuplicates(threshold: number) {
  return useQuery({
    queryKey: ['duplicates', threshold],
    queryFn: () => api.get<DuplicatesResponse>(`/api/channels/duplicates?threshold=${threshold}`),
    staleTime: 0,
  })
}
