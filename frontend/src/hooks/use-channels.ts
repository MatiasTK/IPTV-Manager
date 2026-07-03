import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Channel, ChannelWithAlternatives, ChannelFilters } from '@/lib/types'

function buildChannelsUrl(filters: ChannelFilters = {}) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.groupId) params.set('groupId', String(filters.groupId))
  if (filters.sourceId) params.set('sourceId', String(filters.sourceId))
  if (filters.health) params.set('health', filters.health)
  if (filters.sortBy) params.set('sortBy', filters.sortBy)
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder)
  params.set('limit', String(filters.limit ?? 100))
  if (filters.page) params.set('page', String(filters.page))
  return `/api/channels?${params}`
}

function buildIdsUrl(filters: Omit<ChannelFilters, 'limit' | 'page' | 'sortBy' | 'sortOrder'> = {}) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.groupId) params.set('groupId', String(filters.groupId))
  if (filters.sourceId) params.set('sourceId', String(filters.sourceId))
  if (filters.health) params.set('health', filters.health)
  return `/api/channels/ids?${params}`
}

export function useChannels(filters: ChannelFilters = {}) {
  return useQuery({
    queryKey: ['channels', filters],
    queryFn: () => api.get<{ channels: Channel[]; total: number; page: number; limit: number }>(buildChannelsUrl(filters)),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/** Fetches only IDs matching filters (no pagination) – for cross-page "select all". */
export function useChannelIds(
  filters: Omit<ChannelFilters, 'limit' | 'page' | 'sortBy' | 'sortOrder'>,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['channel-ids', filters],
    queryFn: () => api.get<{ ids: number[]; total: number }>(buildIdsUrl(filters)),
    enabled,
    staleTime: 10_000,
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

export function useBulkDeleteChannels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => api.post('/api/channels/bulk-delete', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useBulkToggleChannels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, is_active }: { ids: number[]; is_active?: number }) =>
      api.patch('/api/channels/bulk-toggle', { ids, is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useBulkEditChannelsGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, groupId }: { ids: number[]; groupId: number | null }) =>
      api.patch('/api/channels/bulk-edit', { ids, groupId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  })
}

export function useDeleteDownChannels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; deletedCount: number }>('/api/channels/delete-down'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      qc.invalidateQueries({ queryKey: ['health'] })
    },
  })
}
