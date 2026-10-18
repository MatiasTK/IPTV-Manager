import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Línea de estado mono 12px (ej. "ÚLTIMO CHEQUEO HACE 4 MIN"). */
  status?: string
  statusColor?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, status, statusColor = '#F2A33A', actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {status && (
          <span className="font-mono text-xs" style={{ color: statusColor }}>
            ● {status}
          </span>
        )}
        <h1 className="text-[34px] leading-tight font-bold tracking-[-0.01em] text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-label">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  )
}
