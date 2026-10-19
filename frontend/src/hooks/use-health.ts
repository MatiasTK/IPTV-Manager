import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HealthStatusResponse, HealthChannel, DuplicatesResponse } from '@/lib/types'

export function useHealthStatus(source = 'all') {
  return useQuery({
    queryKey: ['health', 'status', source],
    queryFn: () => api.get<HealthStatusResponse>(`/api/health/status${source !== 'all' ? `?source=${source}` : ''}`),
    staleTime: 0,
    refetchInterval: (query) => {
      return query.state.data?.isChecking ? 1500 : 30000
    },
  })
}

export interface HealthBreakdownRow { total: number; ok: number; deg: number; down: number }

/** Per-source / per-group health totals, aggregated server side. */
export function useHealthBreakdown() {
  return useQuery({
    queryKey: ['health', 'breakdown'],
    queryFn: () =>
      api.get<{ bySource: (HealthBreakdownRow & { id: number })[]; byGroup: (HealthBreakdownRow & { name: string })[] }>('/api/health/breakdown'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

const HEALTH_PAGE = 100

export function useHealthChannels(source: string, status: string, q: string) {
  return useInfiniteQuery({
    queryKey: ['health', 'channels', source, status, q],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(HEALTH_PAGE), offset: String(pageParam) })
      if (source !== 'all') p.set('source', source)
      if (status !== 'all') p.set('status', status)
      if (q) p.set('q', q)
      return api.get<{ channels: HealthChannel[]; total: number; offset: number; limit: number }>(`/api/health/channels?${p}`)
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.channels.length < last.total ? last.offset + last.limit : undefined),
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
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

const DUP_PAGE = 30

export function useDuplicates(threshold: number, source: string, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['duplicates', threshold, source],
    queryFn: ({ pageParam }) =>
      api.get<DuplicatesResponse>(
        `/api/channels/duplicates?threshold=${threshold}&limit=${DUP_PAGE}&offset=${pageParam}${source !== 'all' ? `&source=${source}` : ''}`
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.groups.length < last.count ? last.offset + last.limit : undefined),
    staleTime: 5 * 60 * 1000,
    enabled: opts.enabled ?? true,
  })
}

export function useAutoGroupDuplicates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { threshold: number; source: string }) =>
      api.post<{ ok: boolean; groups: number }>('/api/channels/duplicates/auto-group', {
        threshold: v.threshold,
        source: v.source !== 'all' ? v.source : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicates'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}
