import { cn, formatLatency } from '@/lib/utils'
import { latencyPercent, statusColor } from '@/lib/status'
import type { HealthStatus } from '@/lib/types'

interface LatencyBarProps {
  status: HealthStatus
  ms: number | null | undefined
  className?: string
}

/** Barra 72×6 con relleno proporcional a la latencia + valor mono. */
export function LatencyBar({ status, ms, className }: LatencyBarProps) {
  const color = statusColor(status)
  const text = status === 'down' ? 'timeout' : formatLatency(ms)
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div aria-hidden="true" className="h-1.5 w-[72px] shrink-0 overflow-hidden rounded-[3px] bg-border">
        <div className="h-1.5 rounded-[3px]" style={{ width: `${latencyPercent(status, ms)}%`, background: color }} />
      </div>
      <span className="font-mono text-xs text-[#C9CED4]">{text}</span>
    </div>
  )
}
