import { useState } from 'react'
import { Copy, RefreshCw, Zap, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { HealthDot } from '@/components/shared/health-badge'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useDuplicates } from '@/hooks/use-health'
import { useBulkAlternatives } from '@/hooks/use-channels'
import type { DuplicateGroup, HealthStatus } from '@/lib/types'
import { toast } from 'sonner'

export default function DuplicatesPage() {
  const [threshold, setThreshold] = useState(80)
  const [pendingThreshold, setPendingThreshold] = useState(80)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [autoGroupOpen, setAutoGroupOpen] = useState(false)
  const [selections, setSelections] = useState<Record<number, string>>({})

  const { data, isLoading, refetch } = useDuplicates(threshold)
  const bulkAlt = useBulkAlternatives()

  const groups = (data?.groups ?? []).filter((_, i) => !dismissed.has(i))

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
    for (let idx = 0; idx < groups.length; idx++) {
      const group = groups[idx]
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

  const handleApplyThreshold = () => {
    setThreshold(pendingThreshold)
    setDismissed(new Set())
    setSelections({})
  }

  return (
    <div>
      <PageHeader
        title="Duplicados"
        subtitle="Canales similares detectados que pueden agruparse como alternativas"
        icon={Copy}
        actions={
          <>
            <Button variant="outline" onClick={() => { refetch(); setDismissed(new Set()) }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-detectar
            </Button>
            {groups.length > 0 && (
              <Button onClick={() => setAutoGroupOpen(true)}>
                <Zap className="w-4 h-4 mr-2" />
                Auto-agrupar todo
              </Button>
            )}
          </>
        }
      />

      {/* Threshold control */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-card border border-border rounded-xl">
        <div className="flex-1">
          <Label className="text-sm font-medium mb-2 block">
            Umbral de similitud: <span className="text-primary font-bold">{pendingThreshold}%</span>
          </Label>
          <Slider
            min={60}
            max={100}
            step={1}
            value={[pendingThreshold]}
            onValueChange={([v]) => setPendingThreshold(v)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>60% (más resultados)</span>
            <span>100% (exactos)</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleApplyThreshold}>
          Aplicar
        </Button>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Copy}
          title="No se detectaron duplicados"
          description={`No hay duplicados con un umbral de similitud del ${threshold}%. Probá reducir el umbral.`}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Se encontraron <span className="text-foreground font-medium">{groups.length}</span> grupo(s) de posibles duplicados.
          </p>

          {groups.map((group, idx) => (
            <Card key={idx}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={group.reason === 'url'
                        ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10'
                        : 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                      }
                    >
                      {group.reason === 'url' ? 'Misma URL' : 'Nombre similar'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Similitud: {Math.round(group.score)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setDismissed((prev) => new Set([...prev, idx]))}
                    >
                      Ignorar
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleGroup(idx, group)}
                      disabled={bulkAlt.isPending}
                    >
                      {bulkAlt.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Zap className="w-3 h-3 mr-1" />
                      )}
                      Agrupar
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={getSelected(idx, group)}
                  onValueChange={(v) => setSelections((prev) => ({ ...prev, [idx]: v }))}
                  className="space-y-2"
                >
                  {group.channels.map((ch) => (
                    <div
                      key={ch.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 border border-border/40 cursor-pointer hover:bg-muted/60 transition-colors"
                      onClick={() => setSelections((prev) => ({ ...prev, [idx]: String(ch.id) }))}
                    >
                      <RadioGroupItem value={String(ch.id)} id={`dup-${idx}-${ch.id}`} />
                      <HealthDot status={ch.health_status as HealthStatus} size="sm" />
                      <Label htmlFor={`dup-${idx}-${ch.id}`} className="flex-1 cursor-pointer text-sm">
                        {ch.name}
                      </Label>
                      {ch.id === group.suggestedPrimaryId && (
                        <Badge variant="secondary" className="text-xs">Sugerido</Badge>
                      )}
                    </div>
                  ))}
                </RadioGroup>
                <p className="text-xs text-muted-foreground mt-2">
                  Selecciona el canal principal. Los demás serán alternativas.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={autoGroupOpen}
        onOpenChange={setAutoGroupOpen}
        title="Auto-agrupar todos los duplicados"
        description={`Se procesarán ${groups.length} grupo(s) usando el canal sugerido como principal. Esta acción no se puede deshacer.`}
        confirmLabel="Auto-agrupar"
        onConfirm={handleAutoGroup}
      />
    </div>
  )
}
