import type { HealthStatus } from '@/lib/types'

export const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: '#5AD1A0',
  degraded: '#F2C14E',
  intermittent: '#B79CFF',
  down: '#FF7A6B',
  unknown: '#8A929B',
}

export const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: 'ONLINE',
  degraded: 'LENTO',
  intermittent: 'INTERMITENTE',
  down: 'CAÍDO',
  unknown: 'SIN DATO',
}

export function statusColor(status: HealthStatus | string | null | undefined): string {
  return STATUS_COLOR[status as HealthStatus] ?? STATUS_COLOR.unknown
}

export function statusLabel(status: HealthStatus | string | null | undefined): string {
  return STATUS_LABEL[status as HealthStatus] ?? STATUS_LABEL.unknown
}

/** Relleno de la barra de latencia en %: min(100, ms/20), mínimo 6; caído = 100; sin dato = 0. */
export function latencyPercent(status: HealthStatus | string | null | undefined, ms: number | null | undefined): number {
  if (status === 'down') return 100
  if (status === 'unknown' || !ms) return 0
  return Math.max(6, Math.min(100, Math.round(ms / 20)))
}
