import { useState } from 'react'
import {
  Activity, Search, Radio, Loader2, RefreshCw,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { HealthBadge, HealthDot } from '@/components/shared/health-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useHealthStatus, useHealthChannels, useCheckNow } from '@/hooks/use-health'
import { useCheckChannelHealth } from '@/hooks/use-channels'
import { formatLatency, formatDate, formatRelativeDate } from '@/lib/utils'
import type { HealthStatus } from '@/lib/types'
import { toast } from 'sonner'

export default function HealthPage() {
  const { data: statusData, isLoading: statusLoading } = useHealthStatus()
  const { data: channelsData, isLoading: channelsLoading } = useHealthChannels()
  const checkNow = useCheckNow()
  const checkSingle = useCheckChannelHealth()
  const [checkingId, setCheckingId] = useState<number | null>(null)

  const summary = statusData?.summary
  const switchLog = statusData?.autoSwitchLog ?? []
  const channels = channelsData?.channels ?? []

  const handleCheckNow = async () => {
    try {
      await checkNow.mutateAsync()
      toast.info('Verificación iniciada. Los resultados se actualizarán en unos segundos.')
    } catch {
      toast.error('Error al iniciar verificación')
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

  return (
    <div>
      <PageHeader
        title="Estado de Streams"
        subtitle="Health checking automático y log de switches"
        icon={Activity}
        actions={
          <Button onClick={handleCheckNow} disabled={checkNow.isPending}>
            {checkNow.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Verificar ahora
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {statusLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : (
          <>
            <StatCard icon={Radio} label="Total Activos" value={summary?.total ?? 0} color="purple" />
            <StatCard icon={Activity} label="Saludables" value={summary?.healthy ?? 0} color="green" />
            <StatCard icon={Activity} label="Lentos" value={summary?.degraded ?? 0} color="amber" />
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
    </div>
  )
}
