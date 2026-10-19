import { useState, useMemo } from 'react'
import { Search, Trash2, Loader2, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useGroups, useBulkDeleteGroups } from '@/hooks/use-groups'
import { useSources } from '@/hooks/use-sources'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface NavEntry {
  value: string
  label: string
  count: number
}

/** "all" is the reset entry; it is never selectable for deletion. */
const isReal = (e: NavEntry) => e.value !== 'all'

function NavColumn({ title, entries, value, onChange, filterable, headerAction, manage }: {
  title: string
  entries: NavEntry[]
  value: string
  onChange: (value: string) => void
  filterable?: boolean
  headerAction?: React.ReactNode
  /** When set, rows get a checkbox and the footer offers bulk actions. */
  manage?: {
    selected: Set<string>
    onSelectedChange: (next: Set<string>) => void
    footer: React.ReactNode
  }
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? entries.filter((e) => e.value === 'all' || e.label.toLowerCase().includes(needle)) : entries
  }, [entries, q])

  const toggle = (v: string) => {
    if (!manage) return
    const next = new Set(manage.selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    manage.onSelectedChange(next)
  }
  const selectable = shown.filter(isReal)
  const allShownSelected = !!manage && selectable.length > 0 && selectable.every((e) => manage.selected.has(e.value))

  return (
    <section aria-label={title} className="flex max-h-64 min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-card lg:max-h-none">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-label">{title}</h2>
        {headerAction}
      </div>
      {filterable && (
        <label className="flex items-center gap-2 border-b border-border px-3.5 py-2">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-label" />
          <span className="sr-only">Filtrar {title.toLowerCase()}</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
            placeholder="Filtrar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      )}
      {manage && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-1.5 text-xs">
          <span className="font-mono text-label">{manage.selected.size.toLocaleString('es-AR')} marcados</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = new Set(manage.selected)
                selectable.forEach((e) => { if (allShownSelected) next.delete(e.value); else next.add(e.value) })
                manage.onSelectedChange(next)
              }}
            >
              {allShownSelected ? 'Desmarcar visibles' : q ? 'Marcar visibles' : 'Marcar todos'}
            </Button>
          </div>
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {shown.map((e) => {
          const checkable = !!manage && isReal(e)
          return (
            <li key={e.value} className="flex items-center gap-1">
              {checkable && (
                <Checkbox
                  aria-label={`Marcar ${e.label}`}
                  className="ml-1.5"
                  checked={manage.selected.has(e.value)}
                  onCheckedChange={() => toggle(e.value)}
                />
              )}
              <button
                type="button"
                aria-pressed={e.value === value}
                onClick={() => (checkable ? toggle(e.value) : onChange(e.value))}
                className={cn(
                  'flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                  e.value === value && !manage ? 'bg-active text-foreground' : 'text-muted-foreground hover:bg-raised hover:text-foreground'
                )}
              >
                <span className="truncate">{e.label}</span>
                <span className="font-mono text-xs text-label">{e.count.toLocaleString('es-AR')}</span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="px-2.5 py-3 text-[13px] text-label">Sin resultados</li>}
      </ul>
      {manage && <div className="border-t border-border p-2">{manage.footer}</div>}
    </section>
  )
}

/** TiviMate-style drill-down: list → groups of that list. Renders two grid cells; the selection lives in the page's filters. */
export function BrowseNav({ sourceFilter, groupFilter, onSource, onGroup }: {
  sourceFilter: string
  groupFilter: string
  onSource: (value: string) => void
  onGroup: (value: string) => void
}) {
  const sourceId = sourceFilter === 'all' ? undefined : Number(sourceFilter)
  const { data: sourcesData } = useSources()
  const { data: groupsData } = useGroups(sourceId)
  const bulkDelete = useBulkDeleteGroups()

  const [managing, setManaging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [exclude, setExclude] = useState(true)

  const sources = sourcesData?.sources ?? []
  const sourceEntries = useMemo<NavEntry[]>(() => [
    { value: 'all', label: 'Todas las listas', count: sources.reduce((n, s) => n + s.channel_count, 0) },
    ...sources.map((s) => ({ value: String(s.id), label: s.name, count: s.channel_count })),
  ], [sources])

  const groups = groupsData?.groups ?? []
  const ungrouped = groupsData?.ungrouped ?? 0
  const groupEntries = useMemo<NavEntry[]>(() => [
    { value: 'all', label: 'Todos los grupos', count: groups.reduce((n, g) => n + g.channel_count, 0) + ungrouped },
    ...groups.map((g) => ({ value: String(g.id), label: g.name, count: g.channel_count })),
    ...(ungrouped > 0 ? [{ value: 'none', label: 'Sin grupo', count: ungrouped }] : []),
  ], [groups, ungrouped])

  const sourceName = sourceId ? sources.find((s) => s.id === sourceId)?.name : undefined
  const selectedEntries = groupEntries.filter((e) => selected.has(e.value))
  const channelTotal = selectedEntries.reduce((n, e) => n + e.count, 0)
  const namedSelected = selectedEntries.filter((e) => e.value !== 'none').length

  const stopManaging = () => { setManaging(false); setSelected(new Set()) }

  const handleDelete = async () => {
    try {
      const ids = [...selected].filter((v) => v !== 'none').map(Number)
      const res = await bulkDelete.mutateAsync({
        ids,
        noGroup: selected.has('none'),
        sourceId,
        exclude: exclude && ids.length > 0,
      })
      toast.success(`${res.deletedChannels.toLocaleString('es-AR')} canales y ${res.deletedGroups.toLocaleString('es-AR')} grupos eliminados`)
      if (selected.has(groupFilter)) onGroup('all')
      stopManaging()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar los grupos')
    } finally {
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <NavColumn title="Listas" entries={sourceEntries} value={sourceFilter} onChange={(v) => { setSelected(new Set()); onSource(v) }} />
      <NavColumn
        title="Grupos"
        entries={groupEntries}
        value={groupFilter}
        onChange={onGroup}
        filterable
        headerAction={
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={managing}
            onClick={() => (managing ? stopManaging() : setManaging(true))}
          >
            <ListChecks aria-hidden="true" />
            {managing ? 'Listo' : 'Gestionar'}
          </Button>
        }
        manage={managing ? {
          selected,
          onSelectedChange: setSelected,
          footer: (
            <Button
              variant="destructive"
              className="w-full"
              disabled={selected.size === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 aria-hidden="true" />
              Eliminar {selected.size > 0 ? `${selected.size.toLocaleString('es-AR')} ` : ''}grupo{selected.size === 1 ? '' : 's'}
            </Button>
          ),
        } : undefined}
      />

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!bulkDelete.isPending) setConfirmOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Eliminar grupos</DialogTitle>
            <DialogDescription>
              Se eliminan {selected.size.toLocaleString('es-AR')} {selected.size === 1 ? 'grupo' : 'grupos'} con{' '}
              {channelTotal.toLocaleString('es-AR')} canales{sourceName ? <> de la lista «{sourceName}»</> : ' de todas las listas'}. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {namedSelected > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <Switch id="exclude-groups-toggle" checked={exclude} onCheckedChange={setExclude} />
              <div className="space-y-0.5">
                <Label htmlFor="exclude-groups-toggle" className="text-sm font-medium">No volver a importarlos</Label>
                <p className="text-xs text-muted-foreground">
                  {sourceName ? 'La sincronización de esta lista los va a saltear.' : 'La sincronización de cada lista afectada los va a saltear.'}{' '}
                  Se pueden reactivar desde Fuentes.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={bulkDelete.isPending}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={bulkDelete.isPending}>
              {bulkDelete.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
