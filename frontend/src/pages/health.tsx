import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity, Search, Radio, Loader2, RefreshCw, Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { HealthBadge, HealthDot } from '@/components/shared/health-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useHealthStatus, useHealthChannels, useCheckNow } from '@/hooks/use-health'
import { useCheckChannelHealth, useDeleteDownChannels } from '@/hooks/use-channels'
import { formatLatency, formatDate, formatRelativeDate } from '@/lib/utils'
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
  const { data: statusData, isLoading: statusLoading } = useHealthStatus()
  const { data: channelsData, isLoading: channelsLoading } = useHealthChannels()
  const checkNow = useCheckNow()
  const checkSingle = useCheckChannelHealth()
  const deleteDown = useDeleteDownChannels()
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const summary = statusData?.summary
  const switchLog = statusData?.autoSwitchLog ?? []
  const channels = channelsData?.channels ?? []

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
      await checkNow.mutateAsync()
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
      const res = await deleteDown.mutateAsync()
      toast.success(`Se eliminaron ${res.deletedCount} canales caídos`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar canales')
    } finally {
      setDeleteConfirmOpen(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Estado de Streams"
        subtitle="Health checking automático y log de switches"
        icon={Activity}
        actions={
          <div className="flex items-center gap-2">
            {summary && summary.down > 0 && (
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteDown.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remover caídos ({summary.down})
              </Button>
            )}
            <Button onClick={handleCheckNow} disabled={checkNow.isPending}>
              {checkNow.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Search className="w-4 h-4 mr-2" />
              )}
              Verificar ahora
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {statusLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : (
          <>
            <StatCard icon={Radio} label="Total Activos" value={summary?.total ?? 0} color="purple" />
            <StatCard icon={Activity} label="Saludables" value={summary?.healthy ?? 0} color="green" />
            <StatCard icon={Activity} label="Lentos" value={summary?.degraded ?? 0} color="amber" />
            <StatCard icon={Activity} label="Intermitentes" value={summary?.intermittent ?? 0} color="orange" />
            <StatCard icon={Activity} label="Caídos" value={summary?.down ?? 0} color="red" />
            <StatCard icon={Activity} label="Sin verificar" value={summary?.unknown ?? 0} color="slate" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Auto-switch log */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" />
              Log de Auto-Switches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {switchLog.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No hay switches registrados</p>
            ) : (
              <div className="space-y-2">
                {switchLog.slice(0, 10).map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground flex-shrink-0 mt-0.5">
                      {formatRelativeDate(entry.timestamp)}
                    </span>
                    <span className="text-foreground">
                      <span className="font-medium">{entry.channelName}</span>
                      <span className="text-muted-foreground"> → alt #{entry.alternativeId}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channels table */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead>Canal</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Latencia</TableHead>
                <TableHead>Alt.</TableHead>
                <TableHead>Último check</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channelsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : channels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      icon={Activity}
                      title="Sin datos de health"
                      description="Ejecutá una verificación para ver el estado de los streams."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                channels.map((ch) => (
                  <TableRow key={ch.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <HealthDot status={ch.health_status as HealthStatus} size="sm" />
                        <span className="text-sm font-medium">{ch.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <HealthBadge status={ch.health_status as HealthStatus} />
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {formatLatency(ch.health_latency_ms)}
                    </TableCell>
                    <TableCell>
                      {ch.alt_count > 0 ? (
                        <Badge variant="secondary" className="text-xs">+{ch.alt_count}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ch.last_health_check ? formatDate(ch.last_health_check) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleCheckSingle(ch.id, ch.name)}
                        disabled={checkingId === ch.id}
                      >
                        {checkingId === ch.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Remover canales caídos"
        description={`¿Estás seguro de que deseas eliminar permanentemente los ${summary?.down || 0} canales que se encuentran caídos? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar canales"
        onConfirm={handleDeleteDown}
        variant="destructive"
      />
    </div>
  )
}
