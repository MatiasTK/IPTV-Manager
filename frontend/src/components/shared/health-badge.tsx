import { cn } from '@/lib/utils'
import { statusColor, statusLabel } from '@/lib/status'
import type { HealthStatus } from '@/lib/types'

interface StatusLabelProps {
  status: HealthStatus
  className?: string
}

/** Punto de 8px + texto mono 12px en mayúsculas, ambos del color del estado. */
export function StatusLabel({ status, className }: StatusLabelProps) {
  const color = statusColor(status)
  return (
    <span
      className={cn('inline-flex items-center gap-2 font-mono text-xs whitespace-nowrap', className)}
      style={{ color }}
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      {statusLabel(status)}
    </span>
  )
}

export const HealthBadge = StatusLabel

interface HealthDotProps {
  status: HealthStatus
  size?: 'sm' | 'md'
  className?: string
}

export function HealthDot({ status, size = 'md', className }: HealthDotProps) {
  return (
    <span
      role="img"
      aria-label={statusLabel(status)}
      className={cn('inline-block shrink-0 rounded-full', size === 'sm' ? 'size-2' : 'size-2.5', className)}
      style={{ background: statusColor(status) }}
    />
  )
}
