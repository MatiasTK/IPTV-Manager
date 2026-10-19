import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { PublishSlotsResponse, PublishPreview } from '@/lib/types'

const KEY = ['publish', 'slots']

export function usePublishSlots() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<PublishSlotsResponse>('/api/publish/slots'),
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data?.publishing ? 1500 : 30_000),
  })
}

function useInvalidating<TVars = void>(fn: (v: TVars) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export const useAssignSlot = () =>
  useInvalidating(({ slot, sourceId }: { slot: number; sourceId: number | null }) =>
    api.put(`/api/publish/slots/${slot}`, { sourceId }))

export const usePublishAll = () => useInvalidating(() => api.post('/api/publish'))
export const usePublishSlot = () => useInvalidating((slot: number) => api.post(`/api/publish/${slot}`))
export const useValidateSlots = () => useInvalidating(() => api.post('/api/publish/validate'))
export const useRotateGist = () => useInvalidating(() => api.post('/api/publish/rotate'))

export function useSlotPreview(slot: number | null) {
  return useQuery({
    queryKey: ['publish', 'preview', slot],
    queryFn: () => api.get<PublishPreview>(`/api/publish/preview/${slot}`),
    enabled: slot !== null,
    staleTime: 0,
  })
}
