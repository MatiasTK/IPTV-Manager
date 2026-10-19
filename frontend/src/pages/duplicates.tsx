import { useMemo, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { StatusLabel } from '@/components/shared/health-badge'
import { LatencyBar } from '@/components/shared/latency-bar'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useDuplicates, useAutoGroupDuplicates } from '@/hooks/use-health'
import { useBulkAlternatives } from '@/hooks/use-channels'
import { useSources } from '@/hooks/use-sources'
import type { DuplicateGroup, HealthStatus } from '@/lib/types'
import { api } from '@/lib/api'
import { toast } from 'sonner'

const simColor = (score: number) => (score >= 90 ? '#5AD1A0' : score >= 75 ? '#F2C14E' : '#A9B0B8')

export default function DuplicatesPage() {
  const [threshold, setThreshold] = useState(80)
  const [pendingThreshold, setPendingThreshold] = useState(80)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [autoGroupOpen, setAutoGroupOpen] = useState(false)
  const [selections, setSelections] = useState<Record<number, string>>({})
  const [source, setSource] = useState('all')
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  const { data, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useDuplicates(threshold, source)
  const { data: sourcesData } = useSources()
  const bulkAlt = useBulkAlternatives()
  const autoGroup = useAutoGroupDuplicates()
  const totalGroups = data?.pages[0]?.count ?? 0

  // Se conserva el índice original para que "descartar" y las selecciones no se desplacen
  const groups = (data?.pages.flatMap((p) => p.groups) ?? [])
    .map((group, index) => ({ group, index }))
    .filter(({ index }) => !dismissed.has(index))

  const [query, setQuery] = useState('')
  const sourceList = sourcesData?.sources ?? []
  const visibleSources = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sourceList.filter((x) => x.name.toLowerCase().includes(q)) : sourceList
  }, [sourceList, query])

  const sourceRow = (id: string, name: string, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => { setSource(id); setActiveIdx(null); setDismissed(new Set()); setSelections({}) }}
      aria-current={id === source ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:text-foreground ${
        id === source ? 'bg-active text-foreground' : 'text-muted-foreground'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {count !== undefined && <span className="shrink-0 font-mono text-[11px] text-label">{count.toLocaleString('es-AR')}</span>}
    </button>
  )

  const active = groups.find((g) => g.index === activeIdx) ?? groups[0]
  const activeIndex = active?.index

  // Descarta/agrupa el grupo y deja seleccionado el siguiente de la lista
  const advance = (idx: number, extra: () => void) => {
    const pos = groups.findIndex((g) => g.index === idx)
    const next = groups[pos + 1] ?? groups[pos - 1]
    setDismissed((prev) => new Set([...prev, idx]))
    setActiveIdx(next ? next.index : null)
    extra()
  }

  const getSelected = (idx: number, group: DuplicateGroup) => {
    return selections[idx] ?? String(group.suggestedPrimaryId)
  }

  const handleGroup = async (idx: number, group: DuplicateGroup) => {
    const primaryId = Number(getSelected(idx, group))
    const alternativeIds = group.channels.map((c) => c.id).filter((id) => id !== primaryId)
    try {
      await bulkAlt.mutateAsync({ primaryId, alternativeIds })
      toast.success('Agrupados como alternativas')
      advance(idx, () => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al agrupar')
    }
  }

  const handleAutoGroup = async () => {
    try {
      const res = await autoGroup.mutateAsync({ threshold, source })
      toast.success(`Auto-agrupado: ${res.groups} grupos procesados`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al auto-agrupar')
    }
    setAutoGroupOpen(false)
    setDismissed(new Set())
    setSelections({})
  }

  const handleRescan = async () => {
    // refresh=1 evita el caché del servidor; después se vuelve a la primera página
    await api.get(`/api/channels/duplicates?threshold=${threshold}&limit=1&refresh=1${source !== 'all' ? `&source=${source}` : ''}`)
    setDismissed(new Set())
    setSelections({})
    refetch()
  }

  const handleCommitThreshold = (v: number) => {
    if (v === threshold) return
    setThreshold(v)
    setDismissed(new Set())
    setSelections({})
  }


  return (
    <>
      <PageHeader
        title="Duplicados"
        subtitle="Canales similares que pueden agruparse: uno queda como principal y el resto como alternativas."
        status={`${totalGroups.toLocaleString('es-AR')} ${totalGroups === 1 ? 'GRUPO DETECTADO' : 'GRUPOS DETECTADOS'} · UMBRAL ${threshold}%`}
        actions={
          <>
            <Button variant="secondary" onClick={handleRescan} disabled={isFetching}>
              {isFetching && <Loader2 aria-hidden="true" className="animate-spin" />}
              Volver a analizar
            </Button>
            {totalGroups > 0 && (
              <Button onClick={() => setAutoGroupOpen(true)} disabled={bulkAlt.isPending || autoGroup.isPending}>
                Auto-agrupar todos
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-[22px]">
        <div className="flex min-w-0 flex-[3_1_560px] flex-col">
          {isLoading ? (
            <Skeleton className="h-[560px] rounded-[10px]" />
          ) : groups.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-control">
              <EmptyState
                icon={Copy}
                title="No quedan duplicados"
                description={`No hay duplicados con un umbral de similitud del ${threshold}%. Bajá el umbral para encontrar coincidencias menos exactas.`}
              />
            </div>
          ) : (
            <section aria-label="Grupos detectados" className="grid h-[calc(100vh-250px)] min-h-[460px] overflow-hidden rounded-[10px] border border-border bg-card md:grid-cols-[340px_1fr]">
              <div className="flex min-h-0 flex-col border-b border-border md:border-r md:border-b-0">
                <div className="border-b border-border px-4 py-2.5 font-mono text-[11px] text-label">
                  {groups.length.toLocaleString('es-AR')} de {totalGroups.toLocaleString('es-AR')} grupos
                </div>
                <ul role="listbox" aria-label="Lista de grupos" className="min-h-0 flex-1 overflow-y-auto">
                  {groups.map(({ group, index }) => {
                    const lead = group.channels.find((c) => c.id === group.suggestedPrimaryId) ?? group.channels[0]
                    const isActive = index === activeIndex
                    return (
                      <li key={index} role="option" aria-selected={isActive}>
                        <button
                          type="button"
                          onClick={() => setActiveIdx(index)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised ${isActive ? 'bg-active' : ''}`}
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-[13px] font-semibold">{lead?.name ?? 'Grupo'}</span>
                            <span className="font-mono text-[10px] tracking-[0.08em] text-label">
                              {group.reason === 'url' ? 'MISMA URL' : 'NOMBRE SIMILAR'} · {group.channels.length} CANALES
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-xs" style={{ color: simColor(group.score) }}>
                            {Math.round(group.score)}%
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {hasNextPage && (
                    <li className="p-3">
                      <Button variant="secondary" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                        {isFetchingNextPage && <Loader2 aria-hidden="true" className="animate-spin" />}
                        Cargar más
                      </Button>
                    </li>
                  )}
                </ul>
              </div>

              {active && (
                <article className="flex min-h-0 flex-col">
                  <div className="flex items-center justify-between gap-2.5 border-b border-border px-5 py-3.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h2 className="truncate text-base font-bold">
                        {(active.group.channels.find((c) => c.id === active.group.suggestedPrimaryId) ?? active.group.channels[0])?.name}
                      </h2>
                      <span className="font-mono text-[10px] tracking-[0.08em] text-label">
                        {active.group.reason === 'url' ? 'MISMA URL' : 'NOMBRE SIMILAR'} · ELEGÍ EL CANAL PRINCIPAL
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-xs" style={{ color: simColor(active.group.score) }}>
                      {Math.round(active.group.score)}% similar
                    </span>
                  </div>
                  <RadioGroup
                    aria-label="Canal principal"
                    value={getSelected(active.index, active.group)}
                    onValueChange={(v) => setSelections((prev) => ({ ...prev, [active.index]: v }))}
                    className="min-h-0 flex-1 gap-0 overflow-y-auto py-1.5"
                  >
                    {active.group.channels.map((ch) => (
                      <Label
                        key={ch.id}
                        htmlFor={`dup-${active.index}-${ch.id}`}
                        className="min-h-12 cursor-pointer gap-3 px-5 py-1 font-normal transition-colors hover:bg-raised"
                      >
                        <RadioGroupItem value={String(ch.id)} id={`dup-${active.index}-${ch.id}`} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold">{ch.name}</span>
                            {ch.id === active.group.suggestedPrimaryId && (
                              <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] text-primary-foreground">SUGERIDO</span>
                            )}
                          </span>
                          <span className="truncate text-xs text-label">{ch.source_name ?? 'Manual'}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <StatusLabel status={ch.health_status as HealthStatus} />
                          <LatencyBar status={ch.health_status as HealthStatus} ms={ch.health_latency_ms} className="gap-2" />
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                  <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                    <Button variant="secondary" size="sm" className="h-10" onClick={() => advance(active.index, () => {})}>
                      Descartar
                    </Button>
                    <Button size="sm" className="h-10" onClick={() => handleGroup(active.index, active.group)} disabled={bulkAlt.isPending}>
                      {bulkAlt.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
                      Agrupar como alternativas
                    </Button>
                  </div>
                </article>
              )}
            </section>
          )}
        </div>
        <aside aria-label="Filtros" className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5">
          <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-card p-4">
            <div className="flex justify-between text-[13px] text-muted-foreground">
              <Label htmlFor="dup-threshold" className="font-normal">Umbral de similitud</Label>
              <span className="font-mono text-primary">{pendingThreshold}%</span>
            </div>
            <Slider
              id="dup-threshold"
              aria-label="Umbral de similitud"
              min={60}
              max={100}
              step={1}
              value={[pendingThreshold]}
              onValueChange={([v]) => setPendingThreshold(v)}
              onValueCommit={([v]) => handleCommitThreshold(v)}
              className="h-8"
            />
            <div className="flex justify-between font-mono text-[11px] text-label">
              <span>60% · más</span>
              <span>100% · exactos</span>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card p-4">
            <h2 className="text-[15px] font-bold">Fuentes <span className="font-mono text-xs font-normal text-label">{sourceList.length}</span></h2>
            {sourceList.length > 6 && (
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar fuentes…" aria-label="Filtrar fuentes" />
            )}
            <div className="flex max-h-[420px] flex-col gap-0.5 overflow-y-auto">
              {!query && sourceRow('all', 'Todas las fuentes', undefined)}
              {visibleSources.map((s) => sourceRow(String(s.id), s.name, s.channel_count))}
              {visibleSources.length === 0 && <span className="px-2.5 py-1.5 text-[13px] text-label">Sin resultados</span>}
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={autoGroupOpen}
        onOpenChange={setAutoGroupOpen}
        title="Auto-agrupar todos los duplicados"
        description={`Se procesarán ${totalGroups.toLocaleString('es-AR')} grupo(s) usando el canal sugerido como principal. Esta acción no se puede deshacer.`}
        confirmLabel="Auto-agrupar"
        variant="default"
        onConfirm={handleAutoGroup}
      />
    </>
  )
}
