import { useState, useMemo, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  ChevronLeft, ChevronRight,
  Loader2, CheckSquare, Square, AlertTriangle, Copy, Search,
} from 'lucide-react'
import type { SourcePreviewResponse, PreviewChannel } from '@/lib/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceName: string
  preview: SourcePreviewResponse
  isSubmitting: boolean
  onConfirm: (selectedUrls: string[], excludedGroups: string[]) => void
}

const PAGE_SIZE = 100

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportPreviewDialog({
  open,
  onOpenChange,
  sourceName,
  preview,
  isSubmitting,
  onConfirm,
}: Props) {
  // Selection: Set<url> — initialized with only non-duplicate channels
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() =>
    new Set(
      preview.channels
        .filter((c) => !c.isDuplicate && !c.isInternalDuplicate)
        .map((c) => c.url)
    )
  )

  // Groups unchecked in the side list: their channels are not imported and the source remembers to skip them on sync
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [groupQuery, setGroupQuery] = useState('')

  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({})

  const channelsByGroup = useMemo(() => {
    const m = new Map<string, PreviewChannel[]>()
    for (const c of preview.channels) {
      if (!c.groupTitle) continue
      const list = m.get(c.groupTitle)
      if (list) list.push(c); else m.set(c.groupTitle, [c])
    }
    return m
  }, [preview.channels])

  const shownGroups = useMemo(() => {
    const needle = groupQuery.trim().toLowerCase()
    return needle ? preview.groups.filter((g) => g.toLowerCase().includes(needle)) : preview.groups
  }, [preview.groups, groupQuery])

  // Filtered list (client-side, all channels already in memory)
  const filtered: PreviewChannel[] = useMemo(() =>
    groupFilter === 'all'
      ? preview.channels
      : preview.channels.filter((c) => c.groupTitle === groupFilter),
    [preview.channels, groupFilter]
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const visible    = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Counts
  const selectedCount         = selectedSet.size
  const filteredSelectedCount = useMemo(
    () => filtered.filter((c) => selectedSet.has(c.url)).length,
    [filtered, selectedSet]
  )
  const pageAllSelected = visible.length > 0 && visible.every((c) => selectedSet.has(c.url))
  const pageSomeSelected = visible.some((c) => selectedSet.has(c.url))

  // ── Selection ops (all O(1) or O(filtered)) ──────────────────────────────

  const toggle = useCallback((url: string, groupTitle?: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(url)) {
        next.delete(url)
      } else {
        next.add(url)
        // Picking a channel of an excluded group brings that group back, or the server would skip it
        if (groupTitle) setExcluded((ex) => { if (!ex.has(groupTitle)) return ex; const e = new Set(ex); e.delete(groupTitle); return e })
      }
      return next
    })
  }, [])

  /** Include/exclude whole groups: keeps the channel selection and the exclusion list in step. */
  const setGroupsIncluded = useCallback((groups: string[], included: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      groups.forEach((g) => { if (included) next.delete(g); else next.add(g) })
      return next
    })
    setSelectedSet((prev) => {
      const next = new Set(prev)
      for (const g of groups) {
        for (const c of channelsByGroup.get(g) ?? []) {
          if (!included) next.delete(c.url)
          else if (!c.isDuplicate && !c.isInternalDuplicate) next.add(c.url)
        }
      }
      return next
    })
  }, [channelsByGroup])

  const selectVisible = useCallback(() => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      filtered.forEach((c) => next.add(c.url))
      return next
    })
    setExcluded((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(prev)
      filtered.forEach((c) => next.delete(c.groupTitle))
      return next
    })
  }, [filtered])

  const deselectVisible = useCallback(() => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      filtered.forEach((c) => next.delete(c.url))
      return next
    })
  }, [filtered])

  const handleHeaderCheckbox = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedSet((prev) => {
        const next = new Set(prev)
        visible.forEach((c) => next.add(c.url))
        return next
      })
      setExcluded((prev) => {
        if (prev.size === 0) return prev
        const next = new Set(prev)
        visible.forEach((c) => next.delete(c.groupTitle))
        return next
      })
    } else {
      setSelectedSet((prev) => {
        const next = new Set(prev)
        visible.forEach((c) => next.delete(c.url))
        return next
      })
    }
  }

  const handleGroupChange = (g: string) => {
    setGroupFilter(g)
    setPage(1)
  }

  const handleConfirm = () => {
    onConfirm([...selectedSet], [...excluded])
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────

  const hasDuplicates = preview.dbDuplicateCount > 0 || preview.internalDuplicateCount > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[92vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[70vw]">
        <DialogHeader className="border-b border-border px-6 pt-5 pb-4 pr-16">
          <DialogTitle className="text-lg">
            Previsualizar importación: <span className="text-primary">{sourceName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
          <div className="flex flex-col gap-0.5 bg-background px-6 py-3.5">
            <span className="text-[11px] tracking-[0.08em] text-label uppercase">Total en lista</span>
            <span className="font-mono text-xl">{preview.total.toLocaleString('es-AR')}</span>
          </div>
          <div className="flex flex-col gap-0.5 bg-background px-6 py-3.5">
            <span className="text-[11px] tracking-[0.08em] text-label uppercase">
              Seleccionados{groupFilter !== 'all' ? ' (del grupo)' : ''}
            </span>
            <span className="font-mono text-xl text-primary">
              {groupFilter !== 'all' ? filteredSelectedCount.toLocaleString('es-AR') : selectedCount.toLocaleString('es-AR')}
              {groupFilter !== 'all' && (
                <span className="ml-1.5 text-sm text-label">/ {selectedCount.toLocaleString('es-AR')} total</span>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 bg-background px-6 py-3.5">
            {hasDuplicates ? (
              <>
                <span className="flex items-center gap-1 text-[11px] tracking-[0.08em] text-degraded uppercase">
                  <AlertTriangle aria-hidden="true" className="size-3" /> Duplicados (pre-deseleccionados)
                </span>
                <div className="flex flex-col gap-0.5 font-mono text-xs">
                  {preview.dbDuplicateCount > 0 && (
                    <span className="text-degraded">{preview.dbDuplicateCount.toLocaleString('es-AR')} ya existen en biblioteca</span>
                  )}
                  {preview.internalDuplicateCount > 0 && (
                    <span className="text-muted-foreground">{preview.internalDuplicateCount.toLocaleString('es-AR')} repetidos en la lista</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="text-[11px] tracking-[0.08em] text-healthy uppercase">Sin duplicados</span>
                <span className="text-sm text-muted-foreground">Todos los canales son nuevos</span>
              </>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <Select value={groupFilter} onValueChange={handleGroupChange}>
            <SelectTrigger aria-label="Grupo" className="w-64 max-w-full md:hidden">
              <SelectValue placeholder="Todos los grupos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                Todos los grupos ({preview.total.toLocaleString()})
              </SelectItem>
              {preview.groups.map((g) => {
                const count = channelsByGroup.get(g)?.length ?? 0
                return (
                  <SelectItem key={g} value={g}>
                    {g} ({count.toLocaleString()})
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={selectVisible}
            >
              <CheckSquare aria-hidden="true" />
              {groupFilter === 'all' ? 'Seleccionar todo' : `Sel. grupo (${filtered.length.toLocaleString()})`}
            </Button>
            <Button
              variant="secondary"
              onClick={deselectVisible}
            >
              <Square aria-hidden="true" />
              {groupFilter === 'all' ? 'Deseleccionar todo' : `Desel. grupo`}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
        {/* Groups: checkbox = import it (unchecked groups are skipped now and on every sync), name = filter the table */}
        <aside aria-label="Grupos de la lista" className="hidden w-72 shrink-0 flex-col border-r border-border md:flex">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <span className="font-mono text-[11px] tracking-wider text-label uppercase">
              Grupos · {(preview.groups.length - excluded.size).toLocaleString('es-AR')}/{preview.groups.length.toLocaleString('es-AR')}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setGroupsIncluded(shownGroups, true)}>Todos</Button>
              <Button variant="ghost" size="sm" onClick={() => setGroupsIncluded(shownGroups, false)}>Ninguno</Button>
            </div>
          </div>
          <label className="flex items-center gap-2 border-b border-border px-4 py-2">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-label" />
            <span className="sr-only">Buscar grupos</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
              placeholder="Buscar grupo…"
              value={groupQuery}
              onChange={(e) => setGroupQuery(e.target.value)}
            />
          </label>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {shownGroups.map((g) => {
              const included = !excluded.has(g)
              return (
                <li key={g} className={`flex items-center gap-2 rounded-md px-2 ${groupFilter === g ? 'bg-active' : 'hover:bg-raised'}`}>
                  <Checkbox
                    aria-label={`Importar el grupo ${g}`}
                    checked={included}
                    onCheckedChange={(c) => setGroupsIncluded([g], c === true)}
                  />
                  <button
                    type="button"
                    aria-pressed={groupFilter === g}
                    onClick={() => handleGroupChange(groupFilter === g ? 'all' : g)}
                    className={`flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 text-left text-[13px] ${included ? 'text-foreground' : 'text-label line-through'}`}
                  >
                    <span className="truncate">{g}</span>
                    <span className="font-mono text-xs text-label">{(channelsByGroup.get(g)?.length ?? 0).toLocaleString('es-AR')}</span>
                  </button>
                </li>
              )
            })}
            {shownGroups.length === 0 && <li className="px-2 py-3 text-[13px] text-label">Sin resultados</li>}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
        {/* Table — scrollable */}
        <div className="flex-1 overflow-auto min-h-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Seleccionar la página"
                    checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                    onCheckedChange={handleHeaderCheckbox}
                  />
                </TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="w-48">Grupo</TableHead>
                <TableHead className="w-32">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((ch, i) => {
                const logoKey = ch.url
                const isSelected = selectedSet.has(ch.url)
                const isDup = ch.isDuplicate || ch.isInternalDuplicate

                return (
                  <TableRow
                    key={`${ch.url}-${i}`}
                    className={`cursor-pointer select-none ${isDup ? 'opacity-60' : ''}`}
                    onClick={() => toggle(ch.url, ch.groupTitle)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Seleccionar ${ch.name}`}
                        checked={isSelected}
                        onCheckedChange={() => toggle(ch.url, ch.groupTitle)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {!ch.tvgLogo || brokenLogos[logoKey] ? (
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] text-[#C9CED4]">
                            {ch.name.slice(0, 2).toUpperCase()}
                          </div>
                        ) : (
                          <img
                            src={`/api/channels/logo-proxy?url=${encodeURIComponent(ch.tvgLogo)}`}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="size-7 shrink-0 rounded-md bg-muted object-contain"
                            onError={() => setBrokenLogos((p) => ({ ...p, [logoKey]: true }))}
                          />
                        )}
                        <span className={`max-w-xs truncate text-sm font-semibold ${!isSelected ? 'font-normal text-muted-foreground' : ''}`}>
                          {ch.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[12rem]">
                      {ch.groupTitle || '—'}
                    </TableCell>
                    <TableCell>
                      {ch.isInternalDuplicate ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                          <Copy aria-hidden="true" className="size-3" />
                          REPETIDO
                        </span>
                      ) : ch.isDuplicate ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-degraded">
                          <AlertTriangle aria-hidden="true" className="size-3" />
                          YA EXISTE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 font-mono text-xs text-healthy">
                          <span aria-hidden="true" className="size-2 rounded-full bg-healthy" />
                          NUEVO
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-6 py-2.5 text-xs text-label">
          <span className="font-mono">
            {filtered.length === 0 ? 'Sin resultados' : (
              <>
                {((safePage - 1) * PAGE_SIZE + 1).toLocaleString('es-AR')}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString('es-AR')} de{' '}
                <span className="text-foreground">{filtered.length.toLocaleString('es-AR')}</span>
                {groupFilter !== 'all' ? ' (filtrado)' : ''}
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono">Pág. {safePage} / {totalPages}</span>
            <Button variant="secondary" size="sm" onClick={() => setPage(safePage - 1)} disabled={safePage === 1}>
              <ChevronLeft aria-hidden="true" />Anterior
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages}>
              Siguiente<ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        </div>
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-border px-6 py-4">
          {excluded.size > 0 && (
            <span className="mr-auto self-center text-xs text-muted-foreground">
              {excluded.size.toLocaleString('es-AR')} {excluded.size === 1 ? 'grupo excluido' : 'grupos excluidos'}: no se importan ni se sincronizan.
            </span>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedCount === 0 || isSubmitting}
            className="min-w-48"
          >
            {isSubmitting ? (
              <><Loader2 aria-hidden="true" className="animate-spin" />Importando...</>
            ) : (
              <>Importar {selectedCount.toLocaleString()} canal{selectedCount !== 1 ? 'es' : ''} →</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
