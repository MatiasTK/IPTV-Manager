import { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from '@/components/ui/table'
import { SortableHead, compareValues, nextSort, type SortState } from '@/components/shared/sortable-head'
import { api } from '@/lib/api'

interface PreviewChannel {
  name: string
  url: string
  group: string
  logo: string
}

type SortKey = 'name' | 'group'

const PAGE_SIZE = 100

interface Props {
  /** URL de la fuente a previsualizar (null = cerrado) */
  url: string | null
  title: string
  onClose: () => void
}

export function ChannelPreviewDialog({ url, title, onClose }: Props) {
  const [channels, setChannels] = useState<PreviewChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<SortKey> | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    setChannels([]); setError(null); setSearch(''); setSort(null); setPage(1); setLoading(true)
    api.post<{ channels: PreviewChannel[] }>('/api/checker/channels', { url, check: false })
      .then(d => { if (!cancelled) setChannels(d.channels) })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Error al cargar canales') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [url])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? channels.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
      : channels
    return sort ? [...list].sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.dir)) : list
  }, [channels, search, sort])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Dialog open={url !== null} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[92vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[70vw]">
        <DialogHeader className="gap-1 border-b border-border p-5 pr-14">
          <DialogTitle>Previsualización de canales</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{title}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 border-b border-border p-4">
          <label className="flex h-11 items-center gap-2.5 rounded-lg border border-control bg-card px-3.5 hover:border-control-strong focus-within:border-control-strong">
            <Search aria-hidden="true" className="size-4 shrink-0 text-label" />
            <span className="sr-only">Buscar canal</span>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Buscar por canal o categoría…"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              disabled={loading}
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary" /> Obteniendo canales…
            </div>
          ) : error ? (
            <p role="alert" className="p-6 text-[13px] text-destructive">{error}</p>
          ) : (
            <Table className="min-w-[640px]">
              <TableHeader className="sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <SortableHead label="Canal" sortKey="name" sort={sort} onSort={k => { setSort(s => nextSort(s, k)); setPage(1) }} />
                  <SortableHead label="Categoría" sortKey="group" sort={sort} onSort={k => { setSort(s => nextSort(s, k)); setPage(1) }} />
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="py-10 text-center text-sm text-label">
                      No se encontraron canales{search ? ` para "${search}"` : ''}
                    </TableCell>
                  </TableRow>
                ) : pageRows.map((ch, i) => (
                  <TableRow key={ch.url + i}>
                    <TableCell className="max-w-[360px]">
                      <div className="flex items-center gap-3">
                        <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted font-mono text-[10px] text-[#C9CED4]">
                          {ch.logo ? (
                            <img
                              src={ch.logo} alt="" referrerPolicy="no-referrer" loading="lazy"
                              className="size-full object-contain"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : ch.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="truncate font-semibold" title={ch.name}>{ch.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{ch.group || '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="secondary" size="icon-sm" aria-label={`Copiar URL de ${ch.name}`}
                          onClick={() => { navigator.clipboard.writeText(ch.url); toast.success('Enlace de canal copiado') }}
                        >
                          <Copy aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!loading && !error && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border p-4 text-[13px] text-label">
            <span className="font-mono">
              {visible.length.toLocaleString('es-AR')} canales
              {visible.length < channels.length ? ` (de ${channels.length.toLocaleString('es-AR')})` : ''}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">Pág. {safePage} / {totalPages}</span>
                <Button variant="secondary" onClick={() => setPage(safePage - 1)} disabled={safePage === 1}>Anterior</Button>
                <Button variant="secondary" onClick={() => setPage(safePage + 1)} disabled={safePage === totalPages}>Siguiente</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
