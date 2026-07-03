import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Source } from '@/lib/types'

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ sources: Source[] }>('/api/sources'),
    staleTime: 30_000,
  })
}

export function useCreateSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<Source>('/api/sources', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  })
}

export function useUpdateSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Record<string, unknown>) =>
      api.put<Source>(`/api/sources/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  })
}

export function useDeleteSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteChannels }: { id: number; deleteChannels: boolean }) =>
      api.delete(`/api/sources/${id}?deleteChannels=${deleteChannels}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useSyncSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; imported: number; updated: number; total: number; duplicatesDetected: number }>(
        `/api/sources/${id}/sync`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useImportText() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ text, sourceName }: { text: string; sourceName?: string }) =>
      api.post<{ ok: boolean; sourceId: number; imported: number; updated: number }>(
        '/api/sources/import-text',
        { text, sourceName }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}
