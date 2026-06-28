import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Channel, ChannelWithAlternatives, ChannelFilters } from '@/lib/types'

function buildChannelsUrl(filters: ChannelFilters = {}) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.groupId) params.set('groupId', String(filters.groupId))
  if (filters.health) params.set('health', filters.health)
  params.set('limit', String(filters.limit ?? 500))
  if (filters.page) params.set('page', String(filters.page))
  return `/api/channels?${params}`
}

export function useChannels(filters: ChannelFilters = {}) {
  return useQuery({
    queryKey: ['channels', filters],
    queryFn: () => api.get<{ channels: Channel[]; total: number }>(buildChannelsUrl(filters)),
    staleTime: 30_000,
  })
}

export function useChannel(id: number | null) {
  return useQuery({
    queryKey: ['channels', id],
    queryFn: () => api.get<ChannelWithAlternatives>(`/api/channels/${id}`),
    enabled: id !== null,
  })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<Channel>('/api/channels', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useUpdateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Record<string, unknown>) =>
      api.put<Channel>(`/api/channels/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/channels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useToggleChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.patch<{ id: number; is_active: number }>(`/api/channels/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useAddAlternative(channelId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (alternativeId: number) =>
      api.post(`/api/channels/${channelId}/alternatives`, { alternativeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', channelId] }),
  })
}

export function useRemoveAlternative(channelId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (altId: number) =>
      api.delete(`/api/channels/${channelId}/alternatives/${altId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', channelId] }),
  })
}

export function useSetPrimary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ altId, oldPrimaryId }: { altId: number; oldPrimaryId: number }) =>
      api.post(`/api/channels/${altId}/set-primary`, { oldPrimaryId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useBulkAlternatives() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ primaryId, alternativeIds }: { primaryId: number; alternativeIds: number[] }) =>
      api.post('/api/channels/bulk-alternatives', { primaryId, alternativeIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useCheckChannelHealth() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ channel: Channel; result: { status: string; latencyMs: number } }>(
        `/api/health/check/${id}`
      ),
  })
}
