import { cn } from '@/lib/utils'
import type { HealthStatus } from '@/lib/types'

const statusConfig: Record<HealthStatus, { label: string; className: string; dotClass: string }> = {
  healthy: {
    label: 'OK',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    dotClass: 'bg-emerald-400',
  },
  degraded: {
    label: 'Lento',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    dotClass: 'bg-amber-400',
  },
  down: {
    label: 'Caído',
    className: 'bg-red-500/15 text-red-400 border-red-500/20',
    dotClass: 'bg-red-400',
  },
  unknown: {
    label: 'Desconocido',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    dotClass: 'bg-slate-400',
  },
}

interface HealthBadgeProps {
  status: HealthStatus
  className?: string
}

export function HealthBadge({ status, className }: HealthBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.unknown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
        config.className,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  )
}

interface HealthDotProps {
  status: HealthStatus
  size?: 'sm' | 'md'
  className?: string
}

export function HealthDot({ status, size = 'md', className }: HealthDotProps) {
  const dotClass: Record<HealthStatus, string> = {
    healthy: 'bg-emerald-400 shadow-[0_0_6px_1px_rgb(52_211_153_/_0.6)]',
    degraded: 'bg-amber-400 shadow-[0_0_6px_1px_rgb(251_191_36_/_0.6)]',
    down: 'bg-red-400 shadow-[0_0_6px_1px_rgb(248_113_113_/_0.6)]',
    unknown: 'bg-slate-500',
  }
  const s = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  return (
    <span
      className={cn('inline-block rounded-full flex-shrink-0', s, dotClass[status] ?? dotClass.unknown, className)}
    />
  )
}
