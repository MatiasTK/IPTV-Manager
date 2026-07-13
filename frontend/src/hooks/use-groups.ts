import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Group } from '@/lib/types'

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<{ groups: Group[] }>('/api/groups'),
    staleTime: 60_000,
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
