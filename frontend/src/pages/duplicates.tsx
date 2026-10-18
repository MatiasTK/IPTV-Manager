import { useState } from 'react'
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
import { useDuplicates } from '@/hooks/use-health'
import { useBulkAlternatives } from '@/hooks/use-channels'
import type { DuplicateGroup, HealthStatus } from '@/lib/types'
import { toast } from 'sonner'

const simColor = (score: number) => (score >= 90 ? '#5AD1A0' : score >= 75 ? '#F2C14E' : '#A9B0B8')

export default function DuplicatesPage() {
  const [threshold, setThreshold] = useState(80)
  const [pendingThreshold, setPendingThreshold] = useState(80)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [autoGroupOpen, setAutoGroupOpen] = useState(false)
  const [selections, setSelections] = useState<Record<number, string>>({})

  const { data, isLoading, isFetching, refetch } = useDuplicates(threshold)
  const bulkAlt = useBulkAlternatives()

  // Se conserva el índice original para que "descartar" y las selecciones no se desplacen
  const groups = (data?.groups ?? [])
    .map((group, index) => ({ group, index }))
    .filter(({ index }) => !dismissed.has(index))

  const getSelected = (idx: number, group: DuplicateGroup) => {
    return selections[idx] ?? String(group.suggestedPrimaryId)
  }

  const handleGroup = async (idx: number, group: DuplicateGroup) => {
    const primaryId = Number(getSelected(idx, group))
    const alternativeIds = group.channels.map((c) => c.id).filter((id) => id !== primaryId)
    try {
      await bulkAlt.mutateAsync({ primaryId, alternativeIds })
      toast.success('Agrupados como alternativas')
      setDismissed((prev) => new Set([...prev, idx]))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al agrupar')
    }
  }

  const handleAutoGroup = async () => {
    let success = 0
    let fail = 0
    for (const { group } of groups) {
      const primaryId = group.suggestedPrimaryId
      const alternativeIds = group.channels.map((c) => c.id).filter((id) => id !== primaryId)
      try {
        await bulkAlt.mutateAsync({ primaryId, alternativeIds })
        success++
      } catch {
        fail++
      }
    }
    toast.success(`Auto-agrupado: ${success} grupos procesados${fail > 0 ? `, ${fail} errores` : ''}`)
    refetch()
    setAutoGroupOpen(false)
    setDismissed(new Set())
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
        status={`${groups.length} ${groups.length === 1 ? 'GRUPO DETECTADO' : 'GRUPOS DETECTADOS'} · UMBRAL ${threshold}%`}
        actions={
          <>
            <Button variant="secondary" onClick={() => { refetch(); setDismissed(new Set()); setSelections({}) }} disabled={isFetching}>
              {isFetching && <Loader2 aria-hidden="true" className="animate-spin" />}
              Volver a analizar
            </Button>
            {groups.length > 0 && (
              <Button onClick={() => setAutoGroupOpen(true)} disabled={bulkAlt.isPending}>
                Auto-agrupar todos
              </Button>
            )}
          </>
        }
      />

      <section aria-label="Umbral de similitud" className="rounded-[10px] border border-border bg-card px-5 py-4">
        <div className="flex flex-col gap-2">
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
            <span>60% · más resultados</span>
            <span>100% · exactos</span>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-[10px]" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-control">
          <EmptyState
            icon={Copy}
            title="No quedan duplicados"
            description={`No hay duplicados con un umbral de similitud del ${threshold}%. Bajá el umbral para encontrar coincidencias menos exactas.`}
          />
        </div>
      ) : (
        <section aria-label="Grupos detectados" className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3.5">
          {groups.map(({ group, index }) => {
            const suggested = group.channels.find((c) => c.id === group.suggestedPrimaryId) ?? group.channels[0]
            const title = suggested?.name ?? 'Grupo'
            return (
              <article key={index} className="flex flex-col rounded-[10px] border border-border bg-card">
                <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 py-3.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 className="truncate text-base font-bold">{title}</h2>
                    <span className="font-mono text-[10px] tracking-[0.08em] text-label">
                      {group.reason === 'url' ? 'MISMA URL' : 'NOMBRE SIMILAR'}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs" style={{ color: simColor(group.score) }}>
                    {Math.round(group.score)}% similar
                  </span>
                </div>
                <RadioGroup
                  aria-label={`Canal principal de ${title}`}
                  value={getSelected(index, group)}
                  onValueChange={(v) => setSelections((prev) => ({ ...prev, [index]: v }))}
                  className="gap-0 py-1.5"
                >
                  {group.channels.map((ch) => (
                    <Label
                      key={ch.id}
                      htmlFor={`dup-${index}-${ch.id}`}
                      className="min-h-12 cursor-pointer gap-3 px-4 py-1 font-normal transition-colors hover:bg-raised"
                    >
                      <RadioGroupItem value={String(ch.id)} id={`dup-${index}-${ch.id}`} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold">{ch.name}</span>
                          {ch.id === group.suggestedPrimaryId && (
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
                <div className="mt-auto flex justify-end gap-2 border-t border-border px-4 py-3">
                  <Button variant="secondary" size="sm" className="h-10" onClick={() => setDismissed((prev) => new Set([...prev, index]))}>
                    Descartar
                  </Button>
                  <Button size="sm" className="h-10" onClick={() => handleGroup(index, group)} disabled={bulkAlt.isPending}>
                    {bulkAlt.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
                    Agrupar como alternativas
                  </Button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      <ConfirmDialog
        open={autoGroupOpen}
        onOpenChange={setAutoGroupOpen}
        title="Auto-agrupar todos los duplicados"
        description={`Se procesarán ${groups.length} grupo(s) usando el canal sugerido como principal. Esta acción no se puede deshacer.`}
        confirmLabel="Auto-agrupar"
        variant="default"
        onConfirm={handleAutoGroup}
      />
    </>
  )
}
