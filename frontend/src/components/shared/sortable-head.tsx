import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string = string> { key: K; dir: SortDir }

/** asc → desc → sin orden */
export function nextSort<K extends string>(cur: SortState<K> | null, key: K): SortState<K> | null {
  if (!cur || cur.key !== key) return { key, dir: 'asc' }
  return cur.dir === 'asc' ? { key, dir: 'desc' } : null
}

/** Compara con los valores vacíos (null/undefined) siempre al final. */
export function compareValues(a: string | number | null | undefined, b: string | number | null | undefined, dir: SortDir): number {
  const aEmpty = a == null || a === ''
  const bEmpty = b == null || b === ''
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  const r = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' })
  return dir === 'asc' ? r : -r
}

interface Props<K extends string> {
  label: string
  sortKey: K
  sort: SortState<K> | null
  onSort: (key: K) => void
  className?: string
}

export function SortableHead<K extends string>({ label, sortKey, sort, onSort, className }: Props<K>) {
  const active = sort?.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          '-mx-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 uppercase transition-colors hover:bg-active hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon aria-hidden="true" className={cn('size-3.5', !active && 'opacity-50')} />
      </button>
    </TableHead>
  )
}
