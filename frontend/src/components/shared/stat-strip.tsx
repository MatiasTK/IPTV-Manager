import { cn } from '@/lib/utils'

export interface StatItem {
  key: string
  label: string
  value: number | string
  /** Texto secundario junto al valor (ej. "93%"). */
  note?: string
  color?: string
  /** Relleno de la barra inferior, 0–100. Sin valor no se dibuja la barra. */
  pct?: number
}

interface StatStripProps {
  items: StatItem[]
  /** Si se pasa, cada stat es un botón que filtra. */
  activeKey?: string
  onSelect?: (key: string) => void
  label?: string
  /** Variante más baja, con el valor en 20px. */
  compact?: boolean
  className?: string
}

export function StatStrip({ items, activeKey, onSelect, label = 'Resumen', compact, className }: StatStripProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden rounded-[10px] border border-border bg-border',
        className
      )}
    >
      {items.map((item) => {
        const color = item.color ?? '#E7E9EC'
        const on = activeKey === item.key
        const body = (
          <>
            <span className="text-[11px] tracking-[0.08em] text-label uppercase">{item.label}</span>
            <span className="flex items-baseline gap-2.5">
              <span className={cn('font-mono leading-none', compact ? 'text-xl' : 'text-[28px]')} style={{ color }}>
                {typeof item.value === 'number' ? item.value.toLocaleString('es-AR') : item.value}
              </span>
              {item.note && <span className="text-xs text-label">{item.note}</span>}
            </span>
            {item.pct !== undefined && (
              <span aria-hidden="true" className="block h-[3px] w-full overflow-hidden rounded-sm bg-border">
                <span className="block h-[3px]" style={{ width: `${item.pct}%`, background: color }} />
              </span>
            )}
          </>
        )
        const base = cn('flex min-h-[44px] flex-col gap-2 px-[18px] text-left', compact ? 'py-3.5' : 'py-4')
        return onSelect ? (
          <button
            key={item.key}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(item.key)}
            className={cn(base, 'transition-colors', on ? 'bg-muted' : 'bg-card hover:bg-[#161A1E]')}
          >
            {body}
          </button>
        ) : (
          <div key={item.key} className={cn(base, 'bg-card')}>
            {body}
          </div>
        )
      })}
    </section>
  )
}
