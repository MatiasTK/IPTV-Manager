import { useState, useMemo } from 'react'
import {
  Radio, Plus, Search, Pencil, Trash2, Link, Activity, Loader2, Tv,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { HealthBadge } from '@/components/shared/health-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ChannelFormDialog } from '@/components/channels/channel-form-dialog'
import { AlternativesDialog } from '@/components/channels/alternatives-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { MoreHorizontal } from 'lucide-react'
import {
  useChannels, useDeleteChannel, useToggleChannel, useCheckChannelHealth,
  useBulkDeleteChannels, useBulkToggleChannels, useBulkEditChannelsGroup,
} from '@/hooks/use-channels'
import { useGroups } from '@/hooks/use-groups'
import { useSources } from '@/hooks/use-sources'
import { useHealthStatus } from '@/hooks/use-health'
import { formatLatency } from '@/lib/utils'
import type { Channel, HealthStatus } from '@/lib/types'
import { toast } from 'sonner'

export default function ChannelsPage() {
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [healthFilter, setHealthFilter] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [altChannel, setAltChannel] = useState<Channel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null)

  // Selection states
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkGroupId, setBulkGroupId] = useState<string>('none')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const { data: channelsData, isLoading } = useChannels({ limit: 500 })
  const { data: groupsData } = useGroups()
  const { data: sourcesData } = useSources()
  const { data: healthData } = useHealthStatus()
  const deleteChannel = useDeleteChannel()
  const toggleChannel = useToggleChannel()
  const checkHealth = useCheckChannelHealth()

  // Bulk actions mutations
  const bulkDelete = useBulkDeleteChannels()
  const bulkToggle = useBulkToggleChannels()
  const bulkEditGroup = useBulkEditChannelsGroup()

  const handleBulkToggle = async (is_active?: number) => {
    try {
      await bulkToggle.mutateAsync({ ids: selectedIds, is_active })
      toast.success('Estado actualizado para los canales seleccionados')
      setSelectedIds([])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar estado')
    }
  }

  const handleBulkDelete = async () => {
    try {
      await bulkDelete.mutateAsync(selectedIds)
      toast.success('Canales eliminados')
      setSelectedIds([])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar canales')
    } finally {
      setBulkDeleteOpen(false)
    }
  }

  const channels = channelsData?.channels ?? []
  const summary = healthData?.summary

  const filtered = useMemo(() => {
    return channels.filter((c) => {
      if (groupFilter !== 'all') {
        if (groupFilter === 'none') {
          if (c.group_id !== null && c.group_id !== undefined) return false
        } else if (String(c.group_id) !== groupFilter) {
          return false
        }
      }
      if (sourceFilter !== 'all' && String(c.source_id) !== sourceFilter) return false
      if (healthFilter !== 'all' && c.health_status !== healthFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!c.name.toLowerCase().includes(q) && !c.url.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [channels, groupFilter, sourceFilter, healthFilter, search])

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteChannel.mutateAsync(deleteTarget.id)
      toast.success('Canal eliminado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeleteTarget(null)
    }
  }

  const handleToggle = async (channel: Channel) => {
    try {
      await toggleChannel.mutateAsync(channel.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar estado')
    }
  }

  const handleCheck = async (channel: Channel) => {
    try {
      const result = await checkHealth.mutateAsync(channel.id)
      toast.success(`${channel.name}: ${result.result.status} (${formatLatency(result.result.latencyMs)})`)
    } catch {
      toast.error('Error al verificar')
    }
  }

  const handleEdit = (channel: Channel) => {
    setEditChannel(channel)
    setFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditChannel(null)
  }

  return (
    <div>
      <PageHeader
        title="Canales"
        subtitle="Gestión de canales de tu lista IPTV"
        icon={Radio}
        actions={
          <Button onClick={() => { setEditChannel(null); setFormOpen(true) }}>
            <Plus className="w-4 h-4 mr-2" />
            Agregar canal
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Radio} label="Total" value={channels.length} color="purple" />
        <StatCard icon={Activity} label="Saludables" value={summary?.healthy ?? 0} color="green" />
        <StatCard icon={Activity} label="Lentos" value={summary?.degraded ?? 0} color="amber" />
        <StatCard icon={Activity} label="Caídos" value={summary?.down ?? 0} color="red" />
      </div>

      {/* Filters or Bulk Actions */}
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/40 border border-border rounded-xl mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.length} {selectedIds.length === 1 ? 'canal seleccionado' : 'canales seleccionados'}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])} className="text-xs h-8 text-muted-foreground hover:text-foreground">
              Deseleccionar todo
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle Status */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Alternar estado
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleBulkToggle(1)}>
                  Activar seleccionados
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkToggle(0)}>
                  Desactivar seleccionados
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkToggle()}>
                  Invertir estado
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Edit Group */}
            <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(true)}>
              Editar grupo
            </Button>

            {/* Delete */}
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar
            </Button>
          </div>
        </div>
      ) : (
        /* Filters */
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar canal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todos los grupos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los grupos</SelectItem>
              {groupsData?.groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
              ))}
              <SelectItem value="none">Sin grupo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todas las fuentes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las fuentes</SelectItem>
              {sourcesData?.sources.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={healthFilter} onValueChange={setHealthFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="healthy">Saludable</SelectItem>
              <SelectItem value="degraded">Lento</SelectItem>
              <SelectItem value="down">Caído</SelectItem>
              <SelectItem value="unknown">Desconocido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-12">
                <Checkbox
                  checked={
                    filtered.length > 0 && filtered.every((ch) => selectedIds.includes(ch.id))
                      ? true
                      : filtered.some((ch) => selectedIds.includes(ch.id))
                      ? "indeterminate"
                      : false
                  }
                  onCheckedChange={(checked) => {
                    if (checked === true) {
                      const allFilteredIds = filtered.map((ch) => ch.id)
                      setSelectedIds((prev) => {
                        const newIds = allFilteredIds.filter((id) => !prev.includes(id))
                        return [...prev, ...newIds]
                      })
                    } else {
                      const filteredIds = filtered.map((ch) => ch.id)
                      setSelectedIds((prev) => prev.filter((id) => !filteredIds.includes(id)))
                    }
                  }}
                />
              </TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Grupo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Latencia</TableHead>
              <TableHead className="w-16">Alt.</TableHead>
              <TableHead className="w-16">Activo</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    icon={Radio}
                    title="No hay canales"
                    description="Importá una lista M3U o creá canales manualmente."
                  />
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((channel) => (
                <TableRow
                  key={channel.id}
                  className={channel.is_active === 0 ? 'opacity-50' : ''}
                >
                  {/* Select Checkbox */}
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(channel.id)}
                      onCheckedChange={(checked) => {
                        setSelectedIds((prev) =>
                          checked === true
                            ? [...prev, channel.id]
                            : prev.filter((id) => id !== channel.id)
                        )
                      }}
                    />
                  </TableCell>

                  {/* Name + logo */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {channel.tvg_logo ? (
                        <img
                          src={channel.tvg_logo}
                          alt=""
                          className="w-7 h-7 rounded object-contain flex-shrink-0 bg-muted"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="w-7 h-7 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Tv className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <span className="font-medium text-sm">{channel.name}</span>
                    </div>
                  </TableCell>

                  {/* Group */}
                  <TableCell className="text-sm text-muted-foreground">
                    {channel.group_name ?? '—'}
                  </TableCell>

                  {/* Health badge */}
                  <TableCell>
                    <HealthBadge status={channel.health_status as HealthStatus} />
                  </TableCell>

                  {/* Latency */}
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    {formatLatency(channel.health_latency_ms)}
                  </TableCell>

                  {/* Alternatives count */}
                  <TableCell>
                    {channel.alt_count > 0 ? (
                      <Badge variant="secondary" className="text-xs font-mono">
                        +{channel.alt_count}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>

                  {/* Active toggle */}
                  <TableCell>
                    <Switch
                      checked={channel.is_active === 1}
                      onCheckedChange={() => handleToggle(channel)}
                    />
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(channel)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAltChannel(channel)}>
                          <Link className="w-4 h-4 mr-2" />
                          Alternativas
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCheck(channel)}>
                          <Activity className="w-4 h-4 mr-2" />
                          Verificar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(channel)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modals */}
      <ChannelFormDialog
        open={formOpen}
        onOpenChange={handleCloseForm}
        channel={editChannel}
      />
      <AlternativesDialog
        open={!!altChannel}
        onOpenChange={(open) => { if (!open) setAltChannel(null) }}
        channel={altChannel}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Eliminar canal"
        description={`¿Eliminar "${deleteTarget?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Eliminar canales"
        description={`¿Eliminar los ${selectedIds.length} canales seleccionados? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleBulkDelete}
      />
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar grupo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Selecciona el grupo que deseas asignar a los {selectedIds.length} canales seleccionados.
            </p>
            <div className="space-y-1.5">
              <Label>Grupo</Label>
              <Select
                value={bulkGroupId}
                onValueChange={setBulkGroupId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin grupo</SelectItem>
                  {groupsData?.groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                try {
                  const groupId = bulkGroupId === 'none' ? null : Number(bulkGroupId)
                  await bulkEditGroup.mutateAsync({ ids: selectedIds, groupId })
                  toast.success('Grupo actualizado para los canales seleccionados')
                  setSelectedIds([])
                  setBulkEditOpen(false)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Error al actualizar grupo')
                }
              }}
            >
              Aplicar grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
