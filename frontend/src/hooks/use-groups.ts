import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Group } from '@/lib/types'

/** With sourceId, counts and groups are scoped to that list. */
export function useGroups(sourceId?: number) {
  return useQuery({
    queryKey: ['groups', sourceId ?? 'all'],
    queryFn: () => api.get<{ groups: Group[]; ungrouped: number }>(sourceId ? `/api/groups?sourceId=${sourceId}` : '/api/groups'),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useCreateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.post<Group>('/api/groups', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useUpdateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.put<Group>(`/api/groups/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useDeleteGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteChannels }: { id: number; deleteChannels: boolean }) =>
      api.delete(`/api/groups/${id}?deleteChannels=${deleteChannels}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useBulkDeleteGroups() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { ids: number[]; noGroup?: boolean; sourceId?: number; exclude?: boolean }) =>
      api.post<{ ok: boolean; deletedChannels: number; deletedGroups: number }>('/api/groups/bulk-delete', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

export function useReorderGroups() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: { id: number; sort_order: number }[]) =>
      api.patch('/api/groups/reorder', { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useAutoSuggestGroups(enabled = false) {
  return useQuery({
    queryKey: ['groups', 'auto-suggest'],
    queryFn: () => api.get<{ suggestions: { groupName: string; channels: { id: number; name: string }[] }[] }>('/api/groups/auto-suggest'),
    enabled,
    staleTime: 0,
  })
}

export function useApplyAutoSuggest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (suggestions: { groupName: string; channelIds: number[] }[]) =>
      api.post('/api/groups/auto-suggest/apply', { suggestions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useDeleteEmptyGroups() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; deletedCount: number }>('/api/groups/delete-empty'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}
