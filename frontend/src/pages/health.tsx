import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, Search, Loader2, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { StatStrip } from '@/components/shared/stat-strip'
import { StatusLabel } from '@/components/shared/health-badge'
import { LatencyBar } from '@/components/shared/latency-bar'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useHealthStatus, useHealthChannels, useCheckNow, useCancelCheck } from '@/hooks/use-health'
import { useCheckChannelHealth, useDeleteDownChannels } from '@/hooks/use-channels'
import { formatLatency, formatRelativeDate } from '@/lib/utils'
import { STATUS_COLOR } from '@/lib/status'
import type { HealthStatus } from '@/lib/types'
import { toast } from 'sonner'

const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass()
    const playBeep = (freq: number, duration: number, startTime: number) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)

      gain.gain.setValueAtTime(0.15, startTime)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

      osc.connect(gain)
      gain.connect(audioCtx.destination)

      osc.start(startTime)
      osc.stop(startTime + duration)
    }

    const now = audioCtx.currentTime
    playBeep(587.33, 0.12, now)
    playBeep(880, 0.15, now + 0.15)
  } catch (err) {
    console.error('Failed to play notification sound', err)
  }
}

export default function HealthPage() {
  const qc = useQueryClient()
  const [source, setSource] = useState('all')
  const [filter, setFilter] = useState<'all' | HealthStatus>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sourceQuery, setSourceQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: statusData, isLoading: statusLoading } = useHealthStatus(source)
  const {
    data: channelsData, isLoading: channelsLoading, isFetching: channelsFetching,
    hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useHealthChannels(source, filter, debouncedSearch)
  const checkNow = useCheckNow()
  const cancelCheck = useCancelCheck()
  const checkSingle = useCheckChannelHealth()
  const deleteDown = useDeleteDownChannels()
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const summary = statusData?.summary
  const switchLog = statusData?.autoSwitchLog ?? []
  const rows = useMemo(() => channelsData?.pages.flatMap((p) => p.channels) ?? [], [channelsData])
  const totalRows = channelsData?.pages[0]?.total ?? 0
  const sourceList = statusData?.sources ?? []
  const visibleSources = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase()
    return q ? sourceList.filter((x) => x.name.toLowerCase().includes(q)) : sourceList
  }, [sourceList, sourceQuery])
  const sourceName = source === 'all' ? null : sourceList.find((x) => String(x.id) === source)?.name ?? null

  const isChecking = statusData?.isChecking ?? false
  const [prevChecking, setPrevChecking] = useState(false)

  useEffect(() => {
    if (isChecking && !prevChecking) {
      toast.loading('Chequeando el estado de los canales...', { id: 'health-check' })
    }
    if (!isChecking && prevChecking) {
      toast.success('Verificación finalizada con éxito!', { id: 'health-check' })
      playNotificationSound()
      qc.invalidateQueries({ queryKey: ['health'] })
    }
    setPrevChecking(isChecking)
  }, [isChecking, prevChecking, qc])

  const handleCheckNow = async () => {
    try {
      toast.loading('Iniciando verificación...', { id: 'health-check' })
      await checkNow.mutateAsync(source !== 'all' && source !== 'none' ? Number(source) : undefined)
    } catch {
      toast.error('Error al iniciar la verificación', { id: 'health-check' })
    }
  }

  const handleCheckSingle = async (id: number, name: string) => {
    setCheckingId(id)
    try {
      const res = await checkSingle.mutateAsync(id)
      toast.success(`${name}: ${res.result.status} (${formatLatency(res.result.latencyMs)})`)
    } catch {
      toast.error('Error al verificar')
    } finally {
      setCheckingId(null)
    }
  }

  const handleDeleteDown = async () => {
    try {
      const res = await deleteDown.mutateAsync(source)
      toast.success(`Se eliminaron ${res.deletedCount} canales caídos`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar canales')
    } finally {
      setDeleteConfirmOpen(false)
    }
  }

  const hostOf = (url: string) => {
    try { return new URL(url).host } catch { return url }
  }

  const clock = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const lastCheck = statusData?.lastCheckAt ?? null
  const nextCheck = statusData?.nextCheckAt ?? null
  const progress = statusData?.progress
  const running = isChecking || checkNow.isPending
  const statusLine = running
    ? 'VERIFICACIÓN EN CURSO'
    : lastCheck
      ? `ÚLTIMO CHEQUEO ${clock(lastCheck)}${nextCheck ? ` · PRÓXIMO ${clock(nextCheck)}` : ''}`
      : 'SIN CHEQUEOS TODAVÍA'
  const progressPct = progress && progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0

  const reasonText = (r: string) => (r === 'primary_down' ? 'Canal principal caído' : r)

  const total = summary?.total ?? 0
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const stats = [
    { key: 'all', label: 'Total activos', value: total, color: '#E7E9EC', pct: 100 },
    { key: 'healthy', label: 'Saludables', value: summary?.healthy ?? 0, color: STATUS_COLOR.healthy, pct: pct(summary?.healthy ?? 0) },
    { key: 'degraded', label: 'Lentos', value: summary?.degraded ?? 0, color: STATUS_COLOR.degraded, pct: pct(summary?.degraded ?? 0) },
    { key: 'intermittent', label: 'Intermitentes', value: summary?.intermittent ?? 0, color: STATUS_COLOR.intermittent, pct: pct(summary?.intermittent ?? 0) },
    { key: 'down', label: 'Caídos', value: summary?.down ?? 0, color: STATUS_COLOR.down, pct: pct(summary?.down ?? 0) },
    { key: 'unknown', label: 'Sin verificar', value: summary?.unknown ?? 0, color: STATUS_COLOR.unknown, pct: pct(summary?.unknown ?? 0) },
  ]
  const titles: Record<string, string> = {
    all: 'Todos los canales', healthy: 'Saludables', degraded: 'Lentos',
    intermittent: 'Intermitentes', down: 'Caídos', unknown: 'Sin verificar',
  }

  return (
    <>
      <PageHeader
        title="Estado de streams"
        subtitle="Health checking automático y log de cambios a alternativas."
        status={statusLine}
        statusColor={running ? '#F2A33A' : '#5AD1A0'}
        actions={
          <>
            {summary && summary.down > 0 && (
              <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)} disabled={deleteDown.isPending}>
                <Trash2 aria-hidden="true" />
                Remover caídos ({summary.down})
              </Button>
            )}
            {isChecking ? (
              <Button variant="secondary" onClick={() => cancelCheck.mutate()} disabled={cancelCheck.isPending}>
                Detener
              </Button>
            ) : (
              <Button onClick={handleCheckNow} disabled={checkNow.isPending}>
                {checkNow.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
                {sourceName ? 'Verificar esta fuente' : 'Verificar ahora'}
              </Button>
            )}
          </>
        }
      />

      {running && (
        <div role="status" className="flex flex-col gap-2">
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>Verificando streams…</span>
            {progress && progress.total > 0 && (
              <span>{progress.checked.toLocaleString('es-AR')} / {progress.total.toLocaleString('es-AR')}</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-border">
            <div className="h-1.5 rounded-[3px] bg-primary transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {statusLoading ? (
        <Skeleton className="h-[104px] rounded-[10px]" />
      ) : (
        <StatStrip items={stats} activeKey={filter} onSelect={(k) => setFilter(k as 'all' | HealthStatus)} />
      )}

      <div className="flex flex-wrap items-start gap-[22px]">
        {/* Canales */}
        <section aria-label="Canales" className="min-w-0 flex-[2_1_560px] overflow-hidden rounded-[10px] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h2 className="text-[15px] font-bold">{titles[filter]}{sourceName ? ` · ${sourceName}` : ''} · {totalRows.toLocaleString('es-AR')}</h2>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar canal…"
              aria-label="Buscar canal"
              className="h-8 max-w-[220px]"
            />
          </div>
          <div className="max-h-[calc(100vh-430px)] min-h-[360px] overflow-y-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Canal</TableHead>
                <TableHead>Fuente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Latencia</TableHead>
                <TableHead className="text-right">Alt.</TableHead>
                <TableHead className="text-right">Último check</TableHead>
                <TableHead className="w-14"><span className="sr-only">Verificar</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channelsLoading || (channelsFetching && rows.length === 0) ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={Activity}
                      title="Sin datos de health"
                      description="Ejecutá una verificación para ver el estado de los streams."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((ch) => {
                  const status = ch.health_status as HealthStatus
                  return (
                    <TableRow key={ch.id}>
                      <TableCell className="max-w-[220px] truncate font-semibold" title={ch.name}>{ch.name}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-muted-foreground" title={ch.source_name ?? undefined}>
                        {ch.source_name ?? <span className="italic">Manual</span>}
                      </TableCell>
                      <TableCell><StatusLabel status={status} /></TableCell>
                      <TableCell><LatencyBar status={status} ms={ch.health_latency_ms} /></TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {ch.alt_count > 0 ? `+${ch.alt_count}` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-label">
                        {ch.last_health_check ? formatRelativeDate(ch.last_health_check) : '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Verificar ${ch.name}`}
                          onClick={() => handleCheckSingle(ch.id, ch.name)}
                          disabled={checkingId === ch.id}
                        >
                          {checkingId === ch.id ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Search aria-hidden="true" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          {hasNextPage && (
            <div className="flex flex-col items-center gap-2 p-3">
              <span className="font-mono text-[11px] text-label">
                {rows.length.toLocaleString('es-AR')} de {totalRows.toLocaleString('es-AR')}
              </span>
              <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage && <Loader2 aria-hidden="true" className="animate-spin" />}
                Cargar más
              </Button>
            </div>
          )}
          </div>
        </section>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
        <section aria-label="Fuentes" className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card p-4">
          <h2 className="text-[15px] font-bold">Fuentes <span className="font-mono text-xs font-normal text-label">{sourceList.length}</span></h2>
          {sourceList.length > 6 && (
            <Input value={sourceQuery} onChange={(e) => setSourceQuery(e.target.value)} placeholder="Filtrar fuentes…" aria-label="Filtrar fuentes" />
          )}
          <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
            {[
              ...(sourceQuery ? [] : [{ id: 'all', name: 'Todas las fuentes', total: undefined as number | undefined, down: 0 }]),
              ...visibleSources.map((x) => ({ id: String(x.id), name: x.name, total: x.total, down: x.down })),
            ].map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setSource(x.id)}
                aria-current={x.id === source ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:text-foreground ${
                  x.id === source ? 'bg-active text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{x.name}</span>
                {x.down > 0 && <span className="shrink-0 font-mono text-[11px]" style={{ color: STATUS_COLOR.down }}>{x.down.toLocaleString('es-AR')}↓</span>}
                {x.total !== undefined && <span className="shrink-0 font-mono text-[11px] text-label">{x.total.toLocaleString('es-AR')}</span>}
              </button>
            ))}
          </div>
        </section>

        {/* Log de switches */}
        <aside aria-label="Log de switches" className="min-w-0 rounded-[10px] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h2 className="text-[15px] font-bold">Log de switches</h2>
            <span className="font-mono text-xs text-label">recientes</span>
          </div>
          {switchLog.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No hay switches registrados</p>
          ) : (
            <ol className="m-0 list-none py-1.5">
              {switchLog.slice(0, 10).map((entry, i) => (
                <li key={i} className="flex gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span className="min-w-11 font-mono text-xs text-label">
                    {clock(entry.timestamp)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold">{entry.channelName}</span>
                    <span className="font-mono text-[11px] break-all text-muted-foreground">
                      {entry.fromSource ?? hostOf(entry.fromUrl)} → <span className="text-healthy">{entry.toSource ?? hostOf(entry.toUrl)}</span>
                    </span>
                    <span className="text-xs text-label">{reasonText(entry.reason)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </aside>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Remover canales caídos"
        description={`¿Estás seguro de que deseas eliminar permanentemente los ${summary?.down || 0} canales caídos${sourceName ? ` de "${sourceName}"` : ''}? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar canales"
        onConfirm={handleDeleteDown}
        variant="destructive"
      />
    </>
  )
}
