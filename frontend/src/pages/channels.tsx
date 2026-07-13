import { useState, useEffect, useCallback } from 'react'
import {
  Radio, Plus, Search, Pencil, Trash2, Link, Activity, Loader2, Tv, RotateCcw,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
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
  useChannels, useChannelIds, useDeleteChannel, useToggleChannel, useCheckChannelHealth,
  useBulkDeleteChannels, useBulkToggleChannels, useBulkEditChannelsGroup,
} from '@/hooks/use-channels'
import { useGroups } from '@/hooks/use-groups'
import { useSources } from '@/hooks/use-sources'
import { useHealthStatus } from '@/hooks/use-health'
import { formatLatency } from '@/lib/utils'
import type { Channel, ChannelFilters, HealthStatus } from '@/lib/types'
import { toast } from 'sonner'

const PAGE_SIZE = 100

// ── Simple debounce hook ────────────────────────────────────────────────────
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

// ── Sort indicator ──────────────────────────────────────────────────────────
function SortIndicator({ field, sortBy, sortOrder }: {
  field: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}) {
  if (sortBy !== field) return <span className="ml-1 text-muted-foreground/40">↕</span>
  return <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
}

export default function ChannelsPage() {
  // ── Filter state (raw input, debounced for server) ──────────────────────
  const [searchInput, setSearchInput] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [healthFilter, setHealthFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<ChannelFilters['sortBy']>(undefined)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  const debouncedSearch = useDebounce(searchInput, 300)

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, groupFilter, sourceFilter, healthFilter, sortBy, sortOrder])

  // ── Modals ──────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [altChannel, setAltChannel] = useState<Channel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkGroupId, setBulkGroupId] = useState<string>('none')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [brokenLogos, setBrokenLogos] = useState<Record<number, boolean>>({})

  // ── Selection state ─────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  // true = user explicitly selected all IDs across all pages
  const [allPagesSelected, setAllPagesSelected] = useState(false)
  // trigger to fetch all IDs for cross-page select
  const [fetchAllIds, setFetchAllIds] = useState(false)

  // ── Active filters object (passed to queries) ───────────────────────────
  const activeFilters: ChannelFilters = {
    search: debouncedSearch || undefined,
    groupId: groupFilter !== 'all' ? (groupFilter === 'none' ? 'none' : Number(groupFilter)) : undefined,
    sourceId: sourceFilter !== 'all' ? Number(sourceFilter) : undefined,
    health: healthFilter !== 'all' ? (healthFilter as HealthStatus) : undefined,
    sortBy,
    sortOrder: sortBy ? sortOrder : undefined,
    page,
    limit: PAGE_SIZE,
  }

  const idsFilters = {
    search: debouncedSearch || undefined,
    groupId: activeFilters.groupId,
    sourceId: activeFilters.sourceId,
    health: activeFilters.health,
  }

  // ── Data queries ────────────────────────────────────────────────────────
  const { data: channelsData, isLoading, isFetching } = useChannels(activeFilters)
  const { data: idsData, isFetching: idsFetching } = useChannelIds(idsFilters, fetchAllIds)
  const { data: groupsData } = useGroups()
  const { data: sourcesData } = useSources()
  const { data: healthData } = useHealthStatus()

  const channels = channelsData?.channels ?? []
  const total = channelsData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const summary = healthData?.summary

  // When IDs arrive after "select all pages" click, apply them
  useEffect(() => {
    if (fetchAllIds && idsData && !idsFetching) {
      setSelectedIds(new Set(idsData.ids))
      setAllPagesSelected(true)
      setFetchAllIds(false)
    }
  }, [fetchAllIds, idsData, idsFetching])

  // ── Bulk mutations ──────────────────────────────────────────────────────
  const deleteChannel   = useDeleteChannel()
  const toggleChannel   = useToggleChannel()
  const checkHealth     = useCheckChannelHealth()
  const bulkDelete      = useBulkDeleteChannels()
  const bulkToggle      = useBulkToggleChannels()
  const bulkEditGroup   = useBulkEditChannelsGroup()

  // ── Helpers ─────────────────────────────────────────────────────────────
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setAllPagesSelected(false)
    setFetchAllIds(false)
  }, [])

  const pageIds = channels.map((c) => c.id)
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const pageSomeSelected = pageIds.some((id) => selectedIds.has(id))

  const handleHeaderCheckbox = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedIds((prev) => new Set([...prev, ...pageIds]))
      setAllPagesSelected(false)
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageIds.forEach((id) => next.delete(id))
        return next
      })
      setAllPagesSelected(false)
    }
  }

  const handleRowCheckbox = (id: number, checked: boolean | 'indeterminate') => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked === true) next.add(id); else next.delete(id)
      return next
    })
    setAllPagesSelected(false)
  }

  const handleSort = (field: NonNullable<ChannelFilters['sortBy']>) => {
    if (sortBy === field) {
      if (sortOrder === 'asc') setSortOrder('desc')
      else { setSortBy(undefined); setSortOrder('asc') }
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const handleBulkToggle = async (is_active?: number) => {
    try {
      await bulkToggle.mutateAsync({ ids: [...selectedIds], is_active })
      toast.success('Estado actualizado')
      clearSelection()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar estado')
    }
  }

  const handleBulkDelete = async () => {
    try {
      await bulkDelete.mutateAsync([...selectedIds])
      toast.success('Canales eliminados')
      clearSelection()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar canales')
    } finally {
      setBulkDeleteOpen(false)
    }
  }

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
    try { await toggleChannel.mutateAsync(channel.id) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Error al cambiar estado') }
  }

  const handleCheck = async (channel: Channel) => {
    try {
      const result = await checkHealth.mutateAsync(channel.id)
      toast.success(`${channel.name}: ${result.result.status} (${formatLatency(result.result.latencyMs)})`)
    } catch {
      toast.error('Error al verificar')
    }
  }

  const hasActiveFilters = !!(debouncedSearch || groupFilter !== 'all' || sourceFilter !== 'all' || healthFilter !== 'all')

  // ── Pagination component ────────────────────────────────────────────────
  const Pagination = () => (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <span className="text-xs text-muted-foreground">
        {total === 0 ? 'Sin resultados' : (
          <>
            Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de{' '}
            <span className="font-medium text-foreground">{total.toLocaleString()}</span> canales
          </>
        )}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(1)} disabled={page === 1}>
          <ChevronsLeft className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="text-xs px-2 text-muted-foreground">
          Pág. {page} / {totalPages}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
          <ChevronsRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )

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

      {/* Stats — use server total, not channels.length */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Radio}    label="Total"      value={total}                  color="purple" />
        <StatCard icon={Activity} label="Saludables" value={summary?.healthy  ?? 0} color="green"  />
        <StatCard icon={Activity} label="Lentos"     value={summary?.degraded ?? 0} color="amber"  />
        <StatCard icon={Activity} label="Caídos"     value={summary?.down     ?? 0} color="red"    />
      </div>

      {/* Bulk actions bar / Filters */}
      {selectedIds.size > 0 ? (
        <div className="space-y-0 mb-4">
          {/* Bulk toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/40 border border-border rounded-t-xl animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {allPagesSelected
                  ? `${selectedIds.size.toLocaleString()} canales seleccionados (todos)`
                  : `${selectedIds.size.toLocaleString()} ${selectedIds.size === 1 ? 'canal seleccionado' : 'canales seleccionados'}`}
              </span>
              <Button variant="ghost" size="sm" onClick={clearSelection} className="text-xs h-8 text-muted-foreground hover:text-foreground">
                Deseleccionar todo
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">Alternar estado</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleBulkToggle(1)}>Activar seleccionados</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkToggle(0)}>Desactivar seleccionados</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkToggle()}>Invertir estado</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(true)}>Editar grupo</Button>
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar
              </Button>
            </div>
          </div>

          {/* "Select all pages" banner — GitHub style */}
          {pageAllSelected && !allPagesSelected && total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-primary/5 border border-t-0 border-border rounded-b-xl text-sm animate-in fade-in duration-150">
              <span className="text-muted-foreground">
                Los {pageIds.length} canales de esta página están seleccionados.
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-primary font-medium"
                onClick={() => setFetchAllIds(true)}
                disabled={idsFetching}
              >
                {idsFetching
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Cargando...</>
                  : `Seleccionar los ${total.toLocaleString()} canales que coinciden con los filtros`}
              </Button>
            </div>
          )}
          {allPagesSelected && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-primary/5 border border-t-0 border-border rounded-b-xl text-sm animate-in fade-in duration-150">
              <span className="text-muted-foreground">
                Todos los <span className="font-medium text-foreground">{selectedIds.size.toLocaleString()}</span> canales están seleccionados.
              </span>
              <Button variant="link" size="sm" className="h-auto p-0 text-primary font-medium" onClick={clearSelection}>
                Cancelar selección
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Filters */
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar canal..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Todos los grupos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los grupos</SelectItem>
              {groupsData?.groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
              ))}
              <SelectItem value="none">Sin grupo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Todas las fuentes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las fuentes</SelectItem>
              {sourcesData?.sources.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={healthFilter} onValueChange={setHealthFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="healthy">Saludable</SelectItem>
              <SelectItem value="degraded">Lento</SelectItem>
              <SelectItem value="intermittent">Intermitente</SelectItem>
              <SelectItem value="down">Caído</SelectItem>
              <SelectItem value="unknown">Desconocido</SelectItem>
            </SelectContent>
          </Select>
          {(sortBy || hasActiveFilters) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSortBy(undefined)
                setSortOrder('asc')
                setSearchInput('')
                setGroupFilter('all')
                setSourceFilter('all')
                setHealthFilter('all')
              }}
              className="h-10 text-xs px-3 border border-dashed border-primary/50 text-primary hover:bg-primary/5 hover:text-primary flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpiar filtros
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Subtle loading indicator that doesn't replace the table */}
        {isFetching && !isLoading && (
          <div className="h-0.5 bg-primary/20 animate-pulse" />
        )}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-12">
                <Checkbox
                  checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                  onCheckedChange={handleHeaderCheckbox}
                />
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('name')}>
                <div className="flex items-center">Canal <SortIndicator field="name" sortBy={sortBy ?? ''} sortOrder={sortOrder} /></div>
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('group')}>
                <div className="flex items-center">Grupo <SortIndicator field="group" sortBy={sortBy ?? ''} sortOrder={sortOrder} /></div>
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('source')}>
                <div className="flex items-center">Fuente <SortIndicator field="source" sortBy={sortBy ?? ''} sortOrder={sortOrder} /></div>
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('status')}>
                <div className="flex items-center">Estado <SortIndicator field="status" sortBy={sortBy ?? ''} sortOrder={sortOrder} /></div>
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('latency')}>
                <div className="flex items-center">Latencia <SortIndicator field="latency" sortBy={sortBy ?? ''} sortOrder={sortOrder} /></div>
              </TableHead>
              <TableHead className="w-16">Alt.</TableHead>
              <TableHead className="w-16">Activo</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : channels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <EmptyState
                    icon={Radio}
                    title="No hay canales"
                    description={hasActiveFilters ? 'Ningún canal coincide con los filtros activos.' : 'Importá una lista M3U o creá canales manualmente.'}
                  />
                </TableCell>
              </TableRow>
            ) : (
              channels.map((channel) => (
                <TableRow key={channel.id} className={channel.is_active === 0 ? 'opacity-50' : ''}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(channel.id)}
                      onCheckedChange={(c) => handleRowCheckbox(channel.id, c)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {!channel.tvg_logo || brokenLogos[channel.id] ? (
                        <div className="w-7 h-7 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Tv className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      ) : (
                        <img
                          src={`/api/channels/logo-proxy?url=${encodeURIComponent(channel.tvg_logo)}`}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded object-contain flex-shrink-0 bg-muted"
                          onError={() => setBrokenLogos((prev) => ({ ...prev, [channel.id]: true }))}
                        />
                      )}
                      <span className="font-medium text-sm">{channel.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{channel.group_name ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {channel.source_name ? (
                      <Badge variant="outline" className="font-normal text-xs text-muted-foreground bg-muted/30 border-muted-foreground/20 max-w-[120px] truncate" title={channel.source_name}>
                        {channel.source_name}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Manual</span>
                    )}
                  </TableCell>
                  <TableCell><HealthBadge status={channel.health_status as HealthStatus} /></TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{formatLatency(channel.health_latency_ms)}</TableCell>
                  <TableCell>
                    {channel.alt_count > 0 ? (
                      <Badge variant="secondary" className="text-xs font-mono">+{channel.alt_count}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch checked={channel.is_active === 1} onCheckedChange={() => handleToggle(channel)} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditChannel(channel); setFormOpen(true) }}>
                          <Pencil className="w-4 h-4 mr-2" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAltChannel(channel)}>
                          <Link className="w-4 h-4 mr-2" />Alternativas
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCheck(channel)}>
                          <Activity className="w-4 h-4 mr-2" />Verificar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(channel)}>
                          <Trash2 className="w-4 h-4 mr-2" />Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination />
      </div>

      {/* Modals */}
      <ChannelFormDialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditChannel(null) }} channel={editChannel} />
      <AlternativesDialog open={!!altChannel} onOpenChange={(open) => { if (!open) setAltChannel(null) }} channel={altChannel} />
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
        description={`¿Eliminar los ${selectedIds.size.toLocaleString()} canales seleccionados? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleBulkDelete}
      />
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Asignar grupo</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Selecciona el grupo para los {selectedIds.size.toLocaleString()} canales seleccionados.
            </p>
            <div className="space-y-1.5">
              <Label>Grupo</Label>
              <Select value={bulkGroupId} onValueChange={setBulkGroupId}>
                <SelectTrigger><SelectValue placeholder="Sin grupo" /></SelectTrigger>
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
            <Button variant="outline" onClick={() => setBulkEditOpen(false)}>Cancelar</Button>
            <Button
              onClick={async () => {
                try {
                  const groupId = bulkGroupId === 'none' ? null : Number(bulkGroupId)
                  await bulkEditGroup.mutateAsync({ ids: [...selectedIds], groupId })
                  toast.success('Grupo actualizado')
                  clearSelection()
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
