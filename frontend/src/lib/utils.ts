import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatDate(dt: string | null | undefined): string {
  if (!dt) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dt))
  } catch {
    return '—'
  }
}

export function formatRelativeDate(dt: string | null | undefined): string {
  if (!dt) return '—'
  try {
    const diff = Date.now() - new Date(dt).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'hace un momento'
    if (mins < 60) return `hace ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `hace ${hours}h`
    const days = Math.floor(hours / 24)
    return `hace ${days}d`
  } catch {
    return '—'
  }
}
