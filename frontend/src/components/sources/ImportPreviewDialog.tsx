import { useState, useMemo, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Tv, Loader2, CheckSquare, Square, AlertTriangle, Copy,
} from 'lucide-react'
import type { SourcePreviewResponse, PreviewChannel } from '@/lib/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceName: string
  preview: SourcePreviewResponse
  isSubmitting: boolean
  onConfirm: (selectedUrls: string[]) => void
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

  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({})

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

  const toggle = useCallback((url: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      next.has(url) ? next.delete(url) : next.add(url)
      return next
    })
  }, [])

  const selectVisible = useCallback(() => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      filtered.forEach((c) => next.add(c.url))
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
    onConfirm([...selectedSet])
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────

  const hasDuplicates = preview.dbDuplicateCount > 0 || preview.internalDuplicateCount > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[92vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[70vw] max-h-[85vh] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="text-base font-semibold">
            Previsualizar importación: <span className="text-primary">{sourceName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total en lista</span>
            <span className="text-2xl font-bold tabular-nums">{preview.total.toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Seleccionados{groupFilter !== 'all' ? ` (del grupo)` : ''}
            </span>
            <span className="text-2xl font-bold tabular-nums text-primary">
              {groupFilter !== 'all' ? filteredSelectedCount.toLocaleString() : selectedCount.toLocaleString()}
              {groupFilter !== 'all' && (
                <span className="text-sm font-normal text-muted-foreground ml-1.5">
                  / {selectedCount.toLocaleString()} total
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {hasDuplicates ? (
              <>
                <span className="text-xs text-amber-500 font-medium uppercase tracking-wide flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Duplicados (pre-deseleccionados)
                </span>
                <div className="flex flex-col gap-0.5 text-sm">
                  {preview.dbDuplicateCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {preview.dbDuplicateCount.toLocaleString()} ya existen en biblioteca
                    </span>
                  )}
                  {preview.internalDuplicateCount > 0 && (
                    <span className="text-muted-foreground">
                      {preview.internalDuplicateCount.toLocaleString()} repetidos en la lista
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="text-xs text-green-500 font-medium uppercase tracking-wide">Sin duplicados</span>
                <span className="text-sm text-muted-foreground">Todos los canales son nuevos</span>
              </>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border flex-wrap">
          <Select value={groupFilter} onValueChange={handleGroupChange}>
            <SelectTrigger className="w-64 h-8 text-sm">
              <SelectValue placeholder="Todos los grupos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                Todos los grupos ({preview.total.toLocaleString()})
              </SelectItem>
              {preview.groups.map((g) => {
                const count = preview.channels.filter((c) => c.groupTitle === g).length
                return (
                  <SelectItem key={g} value={g}>
                    {g} ({count.toLocaleString()})
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={selectVisible}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {groupFilter === 'all' ? 'Seleccionar todo' : `Sel. grupo (${filtered.length.toLocaleString()})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={deselectVisible}
            >
              <Square className="w-3.5 h-3.5" />
              {groupFilter === 'all' ? 'Deseleccionar todo' : `Desel. grupo`}
            </Button>
          </div>
        </div>

        {/* Table — scrollable */}
        <div className="flex-1 overflow-auto min-h-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="w-10">
                  <Checkbox
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
                    onClick={() => toggle(ch.url)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(ch.url)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {!ch.tvgLogo || brokenLogos[logoKey] ? (
                          <div className="w-6 h-6 rounded bg-muted flex items-center justify-center flex-shrink-0">
                            <Tv className="w-3 h-3 text-muted-foreground" />
                          </div>
                        ) : (
                          <img
                            src={`/api/channels/logo-proxy?url=${encodeURIComponent(ch.tvgLogo)}`}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-6 h-6 rounded object-contain flex-shrink-0 bg-muted"
                            onError={() => setBrokenLogos((p) => ({ ...p, [logoKey]: true }))}
                          />
                        )}
                        <span className={`text-sm font-medium truncate max-w-xs ${!isSelected ? 'text-muted-foreground' : ''}`}>
                          {ch.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[12rem]">
                      {ch.groupTitle || '—'}
                    </TableCell>
                    <TableCell>
                      {ch.isInternalDuplicate ? (
                        <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                          <Copy className="w-2.5 h-2.5" />
                          Repetido en lista
                        </Badge>
                      ) : ch.isDuplicate ? (
                        <Badge variant="outline" className="text-[10px] gap-1 font-normal text-amber-600 border-amber-400/50 bg-amber-400/10">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Ya en biblioteca
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-normal text-green-600 border-green-400/50 bg-green-400/10">
                          Nuevo
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <span>
            {filtered.length === 0 ? 'Sin resultados' : (
              <>
                Mostrando {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de{' '}
                <span className="font-medium text-foreground">{filtered.length.toLocaleString()}</span>
                {groupFilter !== 'all' ? ' (filtrado)' : ''}
              </>
            )}
          </span>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPage(1)} disabled={safePage === 1}>
              <ChevronsLeft className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPage((p) => p - 1)} disabled={safePage === 1}>
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <span className="px-2">Pág. {safePage} / {totalPages}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPage((p) => p + 1)} disabled={safePage >= totalPages}>
              <ChevronRight className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>
              <ChevronsRight className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedCount === 0 || isSubmitting}
            className="min-w-48"
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</>
            ) : (
              <>Importar {selectedCount.toLocaleString()} canal{selectedCount !== 1 ? 'es' : ''} →</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
