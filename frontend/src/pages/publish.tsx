import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSources } from '@/hooks/use-sources'
import { useUpdateSettings } from '@/hooks/use-settings'
import {
  usePublishSlots, useAssignSlot, usePublishAll, usePublishSlot, useRotateGist, useValidateSlots, useSlotPreview,
} from '@/hooks/use-publish'
import { formatRelativeDate } from '@/lib/utils'
import type { PublishSlot } from '@/lib/types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado')
const pad = (n: number) => String(n).padStart(2, '0')

export default function PublishPage() {
  const { data, isLoading } = usePublishSlots()
  const { data: sourcesData } = useSources()
  const assign = useAssignSlot()
  const publishAll = usePublishAll()
  const publishOne = usePublishSlot()
  const rotate = useRotateGist()
  const validate = useValidateSlots()
  const updateSettings = useUpdateSettings()

  const [assignSlot, setAssignSlot] = useState<PublishSlot | null>(null)
  const [pickedSource, setPickedSource] = useState('')
  const [freeSlot, setFreeSlot] = useState<PublishSlot | null>(null)
  const [previewSlot, setPreviewSlot] = useState<number | null>(null)
  const [rotateOpen, setRotateOpen] = useState(false)

  const slots = data?.slots ?? []
  const assignedIds = new Set(slots.map((s) => s.sourceId).filter((id): id is number => id !== null))
  const freeSources = (sourcesData?.sources ?? []).filter((s) => !assignedIds.has(s.id))
  const pendingCount = slots.filter((s) => s.sourceId !== null && s.pending).length
  const usedCount = assignedIds.size
  const busy = publishAll.isPending || publishOne.isPending || rotate.isPending || !!data?.publishing

  const run = async (p: Promise<unknown>, ok: string) => {
    try { await p; toast.success(ok) } catch (e) { toast.error(errMsg(e)) }
  }

  const runAssign = async (p: Promise<unknown>, ok: string) => {
    try {
      const r = (await p) as { published?: boolean; publishError?: string }
      if (r?.publishError) toast.error(`Guardado, pero no se pudo publicar: ${r.publishError}`)
      else toast.success(r?.published ? `${ok} y publicado` : `${ok} (sin publicar todavía)`)
    } catch (e) { toast.error(errMsg(e)) }
  }

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success('URL copiada') } catch { toast.error('No se pudo copiar') }
  }

  const openAssign = (slot: PublishSlot) => { setAssignSlot(slot); setPickedSource('') }
  const confirmAssign = async () => {
    if (!assignSlot || !pickedSource) return
    await runAssign(assign.mutateAsync({ slot: assignSlot.slot, sourceId: Number(pickedSource) }), `Slot ${pad(assignSlot.slot)} asignado`)
    setAssignSlot(null)
  }

  const status = !data?.gistId
    ? 'SIN PUBLICAR'
    : pendingCount > 0 ? `${pendingCount} SLOT${pendingCount === 1 ? '' : 'S'} CON CAMBIOS` : 'TODO PUBLICADO'

  return (
    <>
      <PageHeader
        title="Publicación"
        subtitle="Cada slot es una URL fija con una fuente completa. Agregalos una sola vez en TiviMate; después solo asignás y publicás."
        status={`${status} · ${usedCount}/${slots.length} EN USO`}
        statusColor={pendingCount > 0 || !data?.gistId ? '#F2A33A' : '#5AD1A0'}
        actions={
          <>
            <Button variant="secondary" onClick={() => run(validate.mutateAsync(), 'Cuentas verificadas')} disabled={validate.isPending}>
              {validate.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Verificar cuentas
            </Button>
            <Button variant="secondary" onClick={() => setRotateOpen(true)} disabled={busy || !data?.gistId}>Rotar URLs</Button>
            <Button onClick={() => run(publishAll.mutateAsync(), 'Publicado')} disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
              Publicar
            </Button>
          </>
        }
      />

      <section aria-label="Publicación automática" className="flex min-h-11 items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-5 py-3">
        <div className="flex flex-col">
          <Label htmlFor="publish-auto" className="text-sm font-normal">Publicar automáticamente</Label>
          <span className="text-xs text-label">Republica los slots afectados tras sincronizar una fuente o terminar un chequeo. Requiere haber publicado una vez.</span>
        </div>
        <Switch
          id="publish-auto"
          checked={!!data?.auto}
          disabled={!data?.gistId || updateSettings.isPending}
          onCheckedChange={(v) => run(updateSettings.mutateAsync({ publish_auto: v ? '1' : '0' }).then(() => {}), v ? 'Publicación automática activada' : 'Publicación automática desactivada')}
        />
      </section>

      <section aria-label="Slots" className="overflow-hidden rounded-[10px] border border-border bg-card">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14">Slot</TableHead>
              <TableHead>Fuente</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="text-right">Canales</TableHead>
              <TableHead className="text-right">Caídos</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              : slots.map((s) => (
                  <TableRow key={s.slot}>
                    <TableCell className="font-mono text-muted-foreground">{pad(s.slot)}</TableCell>
                    <TableCell className="max-w-[240px]">
                      <div className="truncate font-semibold" title={s.sourceName ?? undefined}>
                        {s.sourceName ?? <span className="font-normal text-label italic">Libre</span>}
                        {s.sourceType && <span className="ml-2 font-mono text-[11px] font-normal text-label">{s.sourceType.toUpperCase()}</span>}
                      </div>
                      {s.warnings.map((w) => (
                        <div key={w} className="truncate text-xs text-[#F2C14E]" title={w}>⚠ {w}</div>
                      ))}
                    </TableCell>
                    <TableCell>
                      {s.url
                        ? <Button variant="ghost" size="sm" onClick={() => copy(s.url!)}>Copiar URL</Button>
                        : <span className="text-label">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{s.sourceId ? s.channelCount.toLocaleString('es-AR') : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{s.sourceId ? s.deadExcluded.toLocaleString('es-AR') : '—'}</TableCell>
                    <TableCell className="text-xs">
                      {s.lastError
                        ? <span className="text-[#F2685B]" title={s.lastError}>Error · {s.lastError.slice(0, 40)}</span>
                        : s.pending
                          ? <span className="text-primary">Cambios sin publicar</span>
                          : <span className="text-label">{s.publishedAt ? `Publicado ${formatRelativeDate(s.publishedAt)}` : '—'}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        {s.sourceId !== null && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setPreviewSlot(s.slot)}>Vista previa</Button>
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(publishOne.mutateAsync(s.slot), `Slot ${pad(s.slot)} publicado`)}>Publicar</Button>
                          </>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => openAssign(s)}>{s.sourceId ? 'Reemplazar' : 'Asignar'}</Button>
                        {s.sourceId !== null && <Button variant="ghost" size="sm" onClick={() => setFreeSlot(s)}>Liberar</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </section>

      <Dialog open={!!assignSlot} onOpenChange={(o) => !o && setAssignSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{assignSlot?.sourceId ? 'Reemplazar' : 'Asignar'} slot {assignSlot && pad(assignSlot.slot)}</DialogTitle>
            <DialogDescription>
              {assignSlot?.sourceId
                ? `Hoy contiene "${assignSlot.sourceName}". Los favoritos y grupos ocultos de TiviMate en este slot pertenecen a esa fuente, y el nombre de la playlist en el dispositivo no cambia.`
                : 'Elegí la fuente que va a publicarse en este slot.'}
            </DialogDescription>
          </DialogHeader>
          {freeSources.length === 0
            ? <p className="text-sm text-label">Todas las fuentes ya están asignadas a un slot.</p>
            : (
              <Select value={pickedSource} onValueChange={setPickedSource}>
                <SelectTrigger aria-label="Fuente"><SelectValue placeholder="Elegí una fuente" /></SelectTrigger>
                <SelectContent>
                  {freeSources.map((src) => <SelectItem key={src.id} value={String(src.id)}>{src.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAssignSlot(null)}>Cancelar</Button>
            <Button onClick={confirmAssign} disabled={!pickedSource || assign.isPending}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!freeSlot}
        onOpenChange={(o) => !o && setFreeSlot(null)}
        title={`Liberar slot ${freeSlot ? pad(freeSlot.slot) : ''}`}
        description="El slot se publica vacío (un canal marcador) ahora mismo. La URL no cambia."
        confirmLabel="Liberar"
        onConfirm={() => { if (freeSlot) runAssign(assign.mutateAsync({ slot: freeSlot.slot, sourceId: null }), 'Slot liberado'); setFreeSlot(null) }}
      />

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotar URLs"
        description="Se crea un gist nuevo y TODAS las URLs cambian: hay que volver a agregarlas en TiviMate en cada dispositivo. Usalo solo si el link se filtró. El gist anterior no se borra solo."
        confirmLabel="Rotar"
        onConfirm={() => { run(rotate.mutateAsync(), 'URLs rotadas'); setRotateOpen(false) }}
      />

      <PreviewDialog slot={previewSlot} onClose={() => setPreviewSlot(null)} />
    </>
  )
}

function PreviewDialog({ slot, onClose }: { slot: number | null; onClose: () => void }) {
  const { data, isLoading } = useSlotPreview(slot)
  return (
    <Dialog open={slot !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vista previa · slot {slot !== null && pad(slot)}</DialogTitle>
          <DialogDescription>
            {isLoading || !data
              ? 'Generando…'
              : `${data.channelCount.toLocaleString('es-AR')} canales (publicado: ${data.previousChannelCount.toLocaleString('es-AR')}), ${data.deadExcluded.toLocaleString('es-AR')} caídos excluidos. ${data.pending ? 'Hay cambios sin publicar.' : 'Sin cambios.'}`}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[360px] overflow-auto rounded-lg border border-control bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {data?.sample}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
