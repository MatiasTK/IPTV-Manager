import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Source, SourcePreviewResponse, ImportResult } from '@/lib/types'

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

/** Preview a source without writing to DB. Returns annotated channel list with duplicate flags. */
export function usePreviewSource() {
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<SourcePreviewResponse>('/api/sources/preview', data),
  })
}

/** Fetch M3U from URL, create source, and import only the selected channels. */
export function useImportUrl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      url: string
      selectedUrls?: string[]
      autoSync?: number
      syncIntervalHours?: number
      priority?: number
      autoPriority?: number
    }) => api.post<ImportResult>('/api/sources/import-url', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useImportText() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ text, sourceName, selectedUrls }: { text: string; sourceName?: string; selectedUrls?: string[] }) =>
      api.post<ImportResult>('/api/sources/import-text', { text, sourceName, selectedUrls }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useImportXtream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      xtreamHost: string
      xtreamUser: string
      xtreamPass: string
      selectedUrls?: string[]
      autoSync?: number
      syncIntervalHours?: number
      priority?: number
      autoPriority?: number
    }) => api.post<ImportResult>('/api/sources/import-xtream', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}
