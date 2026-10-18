import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Radio, Plus, Search, Pencil, Trash2, Link, Activity, Loader2, RotateCcw, ArrowUp, ArrowDown, ArrowUpDown, ChevronsLeft, ChevronsRight,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { StatStrip } from '@/components/shared/stat-strip'
import { FilterChips } from '@/components/shared/filter-chips'
import { StatusLabel } from '@/components/shared/health-badge'
import { LatencyBar } from '@/components/shared/latency-bar'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ChannelFormDialog } from '@/components/channels/channel-form-dialog'
import { AlternativesDialog } from '@/components/channels/alternatives-dialog'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { MoreHorizontal } from 'lucide-react'
import {
  useChannels, useChannelIds, useDeleteChannel, useToggleChannel, useCheckChannelHealth,
  useBulkDeleteChannels, useBulkToggleChannels, useBulkEditChannelsGroup,
} from '@/hooks/use-channels'
import { useGroups } from '@/hooks/use-groups'
import { useSources } from '@/hooks/use-sources'
import { useHealthStatus, useCheckNow } from '@/hooks/use-health'
import { cn, formatLatency, formatRelativeDate } from '@/lib/utils'
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
  if (sortBy !== field) return <ArrowUpDown aria-hidden="true" className="size-3 opacity-40" />
  return sortOrder === 'asc'
    ? <ArrowUp aria-hidden="true" className="size-3 text-foreground" />
    : <ArrowDown aria-hidden="true" className="size-3 text-foreground" />
}

function SortHead({ field, label, sortBy, sortOrder, onSort }: {
  field: NonNullable<ChannelFilters['sortBy']>
  label: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSort: (f: NonNullable<ChannelFilters['sortBy']>) => void
}) {
  const ariaSort = sortBy === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <TableHead aria-sort={ariaSort}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1.5 uppercase hover:text-foreground">
        {label}
        <SortIndicator field={field} sortBy={sortBy} sortOrder={sortOrder} />
      </button>
    </TableHead>
  )
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
  const checkNow        = useCheckNow()
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

  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key === '/' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleCheckAll = async () => {
    try {
      await checkNow.mutateAsync()
      toast.success('Verificación iniciada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al iniciar la verificación')
    }
  }

  const lastCheck = healthData?.lastCheckAt ?? null
  const checking = healthData?.isChecking || checkNow.isPending
  const statusLine = checking
    ? `VERIFICANDO ${(summary?.total ?? total).toLocaleString('es-AR')} CANALES…`
    : lastCheck
      ? `ÚLTIMO CHEQUEO ${formatRelativeDate(lastCheck).toUpperCase()}`
      : 'SIN CHEQUEOS TODAVÍA'

  const pct = (n: number) => (summary && summary.total > 0 ? Math.round((n / summary.total) * 100) : 0)
  const stats = [
    { key: 'total', label: 'Total', value: summary?.total ?? total, note: 'activos', color: '#E7E9EC', pct: 100 },
    { key: 'healthy', label: 'Online', value: summary?.healthy ?? 0, note: `${pct(summary?.healthy ?? 0)}%`, color: '#5AD1A0', pct: pct(summary?.healthy ?? 0) },
    { key: 'degraded', label: 'Degradados', value: summary?.degraded ?? 0, note: '> 1500 ms', color: '#F2C14E', pct: pct(summary?.degraded ?? 0) },
    { key: 'down', label: 'Caídos', value: summary?.down ?? 0, note: `${pct(summary?.down ?? 0)}%`, color: '#FF7A6B', pct: pct(summary?.down ?? 0) },
  ]

  const healthChips = [
    { value: 'all', label: 'Todos', count: summary?.total },
    { value: 'healthy', label: 'Online', count: summary?.healthy },
    { value: 'degraded', label: 'Degradados', count: summary?.degraded },
    { value: 'intermittent', label: 'Intermitentes', count: summary?.intermittent },
    { value: 'down', label: 'Caídos', count: summary?.down },
    { value: 'unknown', label: 'Sin dato', count: summary?.unknown },
  ]

  const rangeText = total === 0
    ? 'Sin resultados'
    : `${((page - 1) * PAGE_SIZE + 1).toLocaleString('es-AR')}–${Math.min(page * PAGE_SIZE, total).toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}`

  const bulkBtn = 'h-9 rounded-[7px] px-3 text-[13px]'

  return (
    <>
      <PageHeader
        title="Canales"
        status={statusLine}
        actions={
          <>
            <Button variant="secondary" onClick={handleCheckAll} disabled={checking}>
              {checking && <Loader2 className="animate-spin" aria-hidden="true" />}
              Verificar todo
            </Button>
            <Button onClick={() => { setEditChannel(null); setFormOpen(true) }}>
              <Plus aria-hidden="true" />
              Nuevo canal
            </Button>
          </>
        }
      />

      <StatStrip
        items={stats}
        className="grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-11 min-w-[240px] flex-[1_1_280px] items-center gap-2.5 rounded-lg border border-control bg-card px-3.5 hover:border-control-strong focus-within:border-control-strong">
          <Search aria-hidden="true" className="size-4 shrink-0 text-label" />
          <span className="sr-only">Buscar canales</span>
          <input
            ref={searchRef}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            placeholder="Buscar por nombre, tvg-id o grupo"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <kbd className="rounded border border-control px-1.5 py-0.5 font-mono text-[11px] text-label">/</kbd>
        </label>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger aria-label="Grupo" className="w-44"><SelectValue placeholder="Todos los grupos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los grupos</SelectItem>
            {groupsData?.groups.map((g) => (
              <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
            ))}
            <SelectItem value="none">Sin grupo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger aria-label="Fuente" className="w-44"><SelectValue placeholder="Todas las fuentes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las fuentes</SelectItem>
            {sourcesData?.sources.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(sortBy || hasActiveFilters) && (
          <Button
            variant="secondary"
            onClick={() => {
              setSortBy(undefined)
              setSortOrder('asc')
              setSearchInput('')
              setGroupFilter('all')
              setSourceFilter('all')
              setHealthFilter('all')
            }}
          >
            <RotateCcw aria-hidden="true" />
            Limpiar filtros
          </Button>
        )}
      </div>
      <FilterChips label="Estado" options={healthChips} value={healthFilter} onChange={setHealthFilter} />

      {/* Barra de selección */}
      {selectedIds.size > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-control bg-raised text-[13px]">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-3.5 py-2.5">
            <span className="font-mono text-primary">
              {allPagesSelected
                ? `${selectedIds.size.toLocaleString('es-AR')} seleccionados (todos)`
                : `${selectedIds.size.toLocaleString('es-AR')} ${selectedIds.size === 1 ? 'seleccionado' : 'seleccionados'}`}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" className={bulkBtn}>Alternar estado</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleBulkToggle(1)}>Activar seleccionados</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkToggle(0)}>Desactivar seleccionados</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkToggle()}>Invertir estado</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" className={bulkBtn} onClick={() => setBulkEditOpen(true)}>Mover a grupo</Button>
            <Button variant="destructive" className={bulkBtn} onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 aria-hidden="true" />
              Eliminar
            </Button>
            <Button variant="ghost" className={cn(bulkBtn, 'ml-auto')} onClick={clearSelection}>Limpiar</Button>
          </div>
          {pageAllSelected && !allPagesSelected && total > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-card px-4 py-2">
              <span className="text-muted-foreground">Los {pageIds.length} canales de esta página están seleccionados.</span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setFetchAllIds(true)} disabled={idsFetching}>
                {idsFetching
                  ? <><Loader2 className="animate-spin" aria-hidden="true" />Cargando...</>
                  : `Seleccionar los ${total.toLocaleString('es-AR')} canales que coinciden con los filtros`}
              </Button>
            </div>
          )}
          {allPagesSelected && (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-card px-4 py-2">
              <span className="text-muted-foreground">
                Todos los <span className="font-medium text-foreground">{selectedIds.size.toLocaleString('es-AR')}</span> canales están seleccionados.
              </span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={clearSelection}>Cancelar selección</Button>
            </div>
          )}
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-[10px] border border-border bg-card">
        {isFetching && !isLoading && <div className="h-0.5 animate-pulse bg-active" />}
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <Checkbox
                  aria-label="Seleccionar todos los canales de la página"
                  checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                  onCheckedChange={handleHeaderCheckbox}
                />
              </TableHead>
              <SortHead field="name" label="Canal" sortBy={sortBy ?? ''} sortOrder={sortOrder} onSort={handleSort} />
              <SortHead field="group" label="Grupo" sortBy={sortBy ?? ''} sortOrder={sortOrder} onSort={handleSort} />
              <SortHead field="source" label="Fuente" sortBy={sortBy ?? ''} sortOrder={sortOrder} onSort={handleSort} />
              <SortHead field="status" label="Estado" sortBy={sortBy ?? ''} sortOrder={sortOrder} onSort={handleSort} />
              <SortHead field="latency" label="Latencia" sortBy={sortBy ?? ''} sortOrder={sortOrder} onSort={handleSort} />
              <TableHead className="w-16 text-right">Alt.</TableHead>
              <TableHead className="w-20">Activo</TableHead>
              <TableHead className="w-14"><span className="sr-only">Acciones</span></TableHead>
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
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9}>
                  <EmptyState
                    icon={Radio}
                    title="No hay canales"
                    description={hasActiveFilters ? 'No hay canales que coincidan con la búsqueda.' : 'Importá una lista M3U o creá canales manualmente.'}
                  />
                </TableCell>
              </TableRow>
            ) : (
              channels.map((channel) => {
                const status = channel.health_status as HealthStatus
                const selected = selectedIds.has(channel.id)
                return (
                  <TableRow
                    key={channel.id}
                    data-state={selected ? 'selected' : undefined}
                    className={cn(selected && 'bg-[#17191D]', channel.is_active === 0 && 'opacity-50')}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Seleccionar ${channel.name}`}
                        checked={selected}
                        onCheckedChange={(c) => handleRowCheckbox(channel.id, c)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {!channel.tvg_logo || brokenLogos[channel.id] ? (
                          <div className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] text-[#C9CED4]">
                            {channel.name.slice(0, 3).toUpperCase()}
                          </div>
                        ) : (
                          <img
                            src={`/api/channels/logo-proxy?url=${encodeURIComponent(channel.tvg_logo)}`}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="size-[34px] shrink-0 rounded-md bg-muted object-contain"
                            onError={() => setBrokenLogos((prev) => ({ ...prev, [channel.id]: true }))}
                          />
                        )}
                        <div className="flex min-w-0 flex-col">
                          <span className="font-semibold">{channel.name}</span>
                          {channel.tvg_id && <span className="font-mono text-[11px] text-[#7C838C]">{channel.tvg_id}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-[#C9CED4]">{channel.group_name ?? '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-muted-foreground" title={channel.source_name ?? undefined}>
                      {channel.source_name ?? <span className="italic">Manual</span>}
                    </TableCell>
                    <TableCell><StatusLabel status={status} /></TableCell>
                    <TableCell><LatencyBar status={status} ms={channel.health_latency_ms} /></TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {channel.alt_count > 0 ? `+${channel.alt_count}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        aria-label={`${channel.is_active === 1 ? 'Desactivar' : 'Activar'} ${channel.name}`}
                        checked={channel.is_active === 1}
                        onCheckedChange={() => handleToggle(channel)}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${channel.name}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditChannel(channel); setFormOpen(true) }}>
                            <Pencil className="mr-2 size-4" />Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setAltChannel(channel)}>
                            <Link className="mr-2 size-4" />Alternativas
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCheck(channel)}>
                            <Activity className="mr-2 size-4" />Verificar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(channel)}>
                            <Trash2 className="mr-2 size-4" />Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 text-[13px] text-label">
        <span className="font-mono">{rangeText}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">Pág. {page} / {totalPages}</span>
          <Button variant="secondary" size="icon" aria-label="Primera página" onClick={() => setPage(1)} disabled={page === 1}>
            <ChevronsLeft aria-hidden="true" />
          </Button>
          <Button variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Anterior</Button>
          <Button variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>Siguiente</Button>
          <Button variant="secondary" size="icon" aria-label="Última página" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
            <ChevronsRight aria-hidden="true" />
          </Button>
        </div>
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
              Seleccioná el grupo para los {selectedIds.size.toLocaleString()} canales seleccionados.
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
            <Button variant="secondary" onClick={() => setBulkEditOpen(false)}>Cancelar</Button>
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
    </>
  )
}
