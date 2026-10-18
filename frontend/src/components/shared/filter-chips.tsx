import { cn } from '@/lib/utils'

export interface ChipOption<T extends string> {
  value: T
  label: string
  count?: number
  /** Punto de color antes de la etiqueta. */
  color?: string
}

interface FilterChipsProps<T extends string> {
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
  label?: string
  className?: string
}

export function FilterChips<T extends string>({ options, value, onChange, label, className }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors',
              on
                ? 'border-control-strong bg-active text-foreground'
                : 'border-control bg-transparent text-muted-foreground hover:bg-raised hover:text-foreground'
            )}
          >
            {opt.color && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: opt.color }} />}
            {opt.label}
            {opt.count !== undefined && (
              <span className="font-mono text-xs text-label">{opt.count.toLocaleString('es-AR')}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
