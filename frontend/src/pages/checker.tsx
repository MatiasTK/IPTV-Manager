import { useState, useRef, useCallback, useEffect } from 'react'
import {
  ShieldCheck, Wifi, WifiOff, Loader2, Play, Trash2,
  Clock, Tv, Calendar, Server, Copy, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, XCircle, Info, List,
  Search, Filter, Radio, RefreshCw
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, getCsrfToken } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServerInfo {
  url: string
  timezone: string | null
  serverProtocol: string | null
  port: string | null
  httpsPort: string | null
  maxConnections: number | null
  activeConnections: number | null
  isTrial: boolean
  username: string
}

interface CheckResult {
  url: string
  type: 'xtream' | 'm3u'
  status: 'online' | 'offline'
  responseTimeMs: number
  channelCount: number | null
  expiresAt: string | null
  serverInfo: ServerInfo | null
  error: string | null
}

type ChannelHealth = 'online' | 'slow' | 'offline' | 'checking' | 'unknown'

interface ChannelEntry {
  name: string
  url: string
  group: string
  logo: string
  health: ChannelHealth
  latencyMs: number
}

interface ChannelSummary {
  total: number
  online: number
  slow: number
  offline: number
}

interface ChannelsData {
  channels: ChannelEntry[]
  summary: ChannelSummary
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch { return '—' }
}

function formatMs(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function getLatencyColor(ms: number): string {
  if (ms <= 0) return 'text-muted-foreground'
  if (ms < 500) return 'text-emerald-400'
  if (ms < 1500) return 'text-amber-400'
  return 'text-red-400'
}

function isExpiringSoon(iso: string | null): boolean {
  if (!iso) return false
  const diff = new Date(iso).getTime() - Date.now()
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false
  return new Date(iso).getTime() < Date.now()
}

function parseUrls(text: string): string[] {
  return text
    .split(/[\s,\n]+/)
    .map(u => u.trim())
    .filter(u => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')))
}

function playInVlc(name: string, url: string) {
  const content = `#EXTM3U\n#EXTINF:-1,${name}\n${url}\n`
  const blob = new Blob([content], { type: 'audio/x-mpegurl' })
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = `${name.replace(/[/\\?%*:|"<>]/g, '-')}.m3u`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

function healthColor(h: ChannelHealth): string {
  if (h === 'online')  return 'text-emerald-400'
  if (h === 'slow')    return 'text-amber-400'
  if (h === 'checking') return 'text-primary animate-pulse font-medium'
  if (h === 'unknown')  return 'text-muted-foreground/60'
  return 'text-red-400'
}
function healthBg(h: ChannelHealth): string {
  if (h === 'online')  return 'bg-emerald-500/10 border-emerald-500/20'
  if (h === 'slow')    return 'bg-amber-500/10 border-amber-500/20'
  if (h === 'checking') return 'bg-primary/5 border-primary/20'
  if (h === 'unknown')  return 'bg-muted/10 border-border/10'
  return 'bg-red-500/10 border-red-500/20'
}
function healthDot(h: ChannelHealth): string {
  if (h === 'online')  return 'bg-emerald-400'
  if (h === 'slow')    return 'bg-amber-400'
  if (h === 'checking') return 'bg-primary animate-pulse'
  if (h === 'unknown')  return 'bg-muted-foreground/30'
  return 'bg-red-400'
}
function healthLabel(h: ChannelHealth): string {
  if (h === 'online')  return 'Online'
  if (h === 'slow')    return 'Lento'
  if (h === 'checking') return 'Verificando...'
  if (h === 'unknown')  return 'Sin verificar'
  return 'Offline'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'online' | 'offline' }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Online
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/25">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      Offline
    </span>
  )
}

function TypeBadge({ type }: { type: 'xtream' | 'm3u' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
      type === 'xtream'
        ? 'bg-violet-500/15 text-violet-400 border border-violet-500/20'
        : 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
    )}>
      {type === 'xtream' ? <Server className="w-2.5 h-2.5" /> : <Tv className="w-2.5 h-2.5" />}
      {type}
    </span>
  )
}

function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <span className="text-muted-foreground text-sm">—</span>

  const expired = isExpired(expiresAt)
  const warning = !expired && isExpiringSoon(expiresAt)

  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-medium',
      expired && 'text-red-400',
      warning && 'text-amber-400',
      !expired && !warning && 'text-muted-foreground'
    )}>
      <Calendar className="w-3 h-3" />
      {expired ? 'Expirado: ' : ''}{formatDate(expiresAt)}
      {expired && <AlertCircle className="w-3 h-3 ml-0.5" />}
      {warning && <AlertCircle className="w-3 h-3 ml-0.5 text-amber-400" />}
    </span>
  )
}

// ── Channel Health Panel ───────────────────────────────────────────────────────

type HealthFilter = 'all' | ChannelHealth

interface ChannelHealthPanelProps {
  data: ChannelsData
  setData: React.Dispatch<React.SetStateAction<ChannelsData | null>>
  checkingInProgress: boolean
  onStartBulkCheck: () => Promise<void>
}

function ChannelHealthPanel({ data, setData, checkingInProgress, onStartBulkCheck }: ChannelHealthPanelProps) {
  const [filter, setFilter]   = useState<HealthFilter>('all')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  
  const PAGE_SIZE = 100

  const { channels, summary } = data

  const filtered = channels.filter(ch => {
    if (filter !== 'all' && ch.health !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return ch.name.toLowerCase().includes(q) || ch.group.toLowerCase().includes(q)
    }
    return true
  })

  // Reset to first page on search or filter change
  useEffect(() => {
    setPage(1)
  }, [filter, search])

  const checkingCount = channels.filter(c => c.health === 'checking').length
  const unknownCount  = channels.filter(c => c.health === 'unknown').length

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages))
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleProbeChannel = async (chUrl: string) => {
    // Set that single channel to 'checking'
    setData(prev => {
      if (!prev) return null
      const newChannels = prev.channels.map(c => {
        if (c.url === chUrl) {
          return { ...c, health: 'checking' as ChannelHealth, latencyMs: 0 }
        }
        return c
      })
      return { ...prev, channels: newChannels }
    })

    try {
      const res = await api.post<{ health: ChannelHealth; latencyMs: number }>('/api/checker/probe', { url: chUrl })
      setData(prev => {
        if (!prev) return null
        const newChannels = prev.channels.map(c => {
          if (c.url === chUrl) {
            return { ...c, health: res.health as ChannelHealth, latencyMs: res.latencyMs }
          }
          return c
        })

        // Count health dynamically
        let online = 0, slow = 0, offline = 0
        for (const ch of newChannels) {
          if (ch.health === 'online') online++
          else if (ch.health === 'slow') slow++
          else if (ch.health === 'offline') offline++
        }

        return {
          channels: newChannels,
          summary: { total: newChannels.length, online, slow, offline }
        }
      })
    } catch (err: any) {
      toast.error(err?.message || 'Error al verificar canal')
      setData(prev => {
        if (!prev) return null
        const newChannels = prev.channels.map(c => {
          if (c.url === chUrl) {
            return { ...c, health: 'offline' as ChannelHealth, latencyMs: 0 }
          }
          return c
        })
        return { ...prev, channels: newChannels }
      })
    }
  }

  const filterButtons: { key: HealthFilter; label: string; count: number; color: string; dotColor: string }[] = [
    { key: 'all',      label: 'Todos',          count: summary.total,   color: 'text-foreground',    dotColor: 'bg-primary' },
    { key: 'online',   label: 'Online',         count: summary.online,  color: 'text-emerald-400',   dotColor: 'bg-emerald-400' },
    { key: 'slow',     label: 'Lentos',         count: summary.slow,    color: 'text-amber-400',     dotColor: 'bg-amber-400' },
    { key: 'offline',  label: 'Offline',        count: summary.offline, color: 'text-red-400',       dotColor: 'bg-red-400' },
    { key: 'checking', label: 'Verificando',    count: checkingCount,   color: 'text-primary animate-pulse', dotColor: 'bg-primary' },
    { key: 'unknown',  label: 'Sin verificar',  count: unknownCount,    color: 'text-muted-foreground/60', dotColor: 'bg-muted-foreground/30' },
  ]

  return (
    <div className="border-t border-border/50 bg-muted/[0.08]">
      {/* Summary counters */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-3 flex items-center gap-1.5">
          <Radio className="w-3 h-3" /> Estado de canales · {summary.total.toLocaleString()} total
        </p>

        {/* Progress bar */}
        <div className="flex h-2 rounded-full overflow-hidden gap-px mb-3 bg-muted/50">
          {summary.online  > 0 && (
            <div
              className="bg-emerald-500 transition-all duration-700 rounded-l-full"
              style={{ width: `${(summary.online / summary.total) * 100}%` }}
              title={`Online: ${summary.online}`}
            />
          )}
          {summary.slow    > 0 && (
            <div
              className="bg-amber-500 transition-all duration-700"
              style={{ width: `${(summary.slow / summary.total) * 100}%` }}
              title={`Lentos: ${summary.slow}`}
            />
          )}
          {summary.offline > 0 && (
            <div
              className="bg-red-500 transition-all duration-700 rounded-r-full"
              style={{ width: `${(summary.offline / summary.total) * 100}%` }}
              title={`Offline: ${summary.offline}`}
            />
          )}
        </div>

        {/* Filter pills + counts */}
        <div className="flex items-center gap-2 flex-wrap">
          {filterButtons.map(({ key, label, count, color, dotColor }) => (
            count > 0 || key === 'all' ? (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150',
                  filter === key
                    ? 'bg-primary/15 border-primary/30 text-primary'
                    : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} />
                <span className={filter === key ? '' : color}>{label}</span>
                <span className="font-bold font-mono">{count}</span>
              </button>
            ) : null
          ))}

          {/* Search and Action Buttons */}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-[11px] font-semibold gap-1.5",
                checkingInProgress && "animate-pulse border-primary/30 text-primary bg-primary/5 hover:bg-primary/5"
              )}
              onClick={onStartBulkCheck}
              disabled={checkingInProgress}
            >
              {checkingInProgress ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              ) : (
                <Play className="w-3 h-3 fill-current text-emerald-450" />
              )}
              {checkingInProgress ? 'Verificando...' : 'Verificar todos'}
            </Button>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="Buscar canal..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={cn(
                  'pl-7 pr-3 py-1 text-xs rounded-lg border border-border bg-muted/40',
                  'text-foreground placeholder:text-muted-foreground/40',
                  'focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30',
                  'transition-all w-36'
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Channel list */}
      <div className="max-h-96 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron canales{search ? ` para "${search}"` : ''}
          </div>
        ) : (
          <div className="space-y-0.5">
            {paginated.map((ch, i) => (
              <div
                key={ch.url + i}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-xs group',
                  'hover:bg-muted/40 transition-colors duration-100'
                )}
              >
                {/* Logo or radio icon */}
                <div className="w-6 h-6 rounded flex-shrink-0 overflow-hidden bg-muted/60 flex items-center justify-center">
                  {ch.logo ? (
                    <img
                      src={ch.logo}
                      alt=""
                      className="w-full h-full object-contain"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <Radio className="w-3 h-3 text-muted-foreground/50" />
                  )}
                </div>

                {/* Name & group */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{ch.name}</p>
                  {ch.group && (
                    <p className="text-[10px] text-muted-foreground/60 truncate">{ch.group}</p>
                  )}
                </div>

                {/* Latency */}
                {ch.latencyMs > 0 && (
                  <span className={cn('font-mono text-[10px] flex-shrink-0', getLatencyColor(ch.latencyMs))}>
                    {formatMs(ch.latencyMs)}
                  </span>
                )}

                {/* Health dot */}
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold flex-shrink-0',
                  healthBg(ch.health)
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', healthDot(ch.health), ch.health === 'online' && 'animate-pulse')} />
                  <span className={healthColor(ch.health)}>{healthLabel(ch.health)}</span>
                </span>

                {/* Verify single channel */}
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-md flex-shrink-0",
                    ch.health === 'checking' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                  onClick={() => handleProbeChannel(ch.url)}
                  disabled={checkingInProgress || ch.health === 'checking'}
                  title="Verificar este canal"
                >
                  {ch.health === 'checking' ? (
                    <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                </Button>

                {/* Copy stream URL */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all rounded-md flex-shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(ch.url)
                    toast.success('Enlace de canal copiado')
                  }}
                  title="Copiar enlace de transmisión"
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {filtered.length > 0 && filtered.length < channels.length && (
        <p className="px-4 pb-3 text-[10px] text-muted-foreground/50 text-center">
          Mostrando {filtered.length} de {channels.length.toLocaleString()} canales
        </p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 pb-4 pt-2 border-t border-border/20 bg-muted/[0.04] mt-2">
          <span className="text-[11px] text-muted-foreground">
            Página {safePage} de {totalPages} · {filtered.length.toLocaleString()} canales
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-[11px] font-medium"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-[11px] font-medium"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Result Card ───────────────────────────────────────────────────────────────

function ResultCard({ result, index }: { result: CheckResult; index: number }) {
  const [infoExpanded, setInfoExpanded]       = useState(false)
  const [channelsData, setChannelsData]       = useState<ChannelsData | null>(null)
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [channelsError, setChannelsError]     = useState<string | null>(null)
  const [channelsOpen, setChannelsOpen]             = useState(false)
  const [checkingInProgress, setCheckingInProgress] = useState(false)

  const isOnline = result.status === 'online'

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(result.url)
    toast.success('URL copiada')
  }

  const handleLoadChannels = useCallback(async () => {
    if (channelsData) {
      // Already loaded — just toggle visibility
      setChannelsOpen(o => !o)
      return
    }

    setChannelsLoading(true)
    setChannelsError(null)
    setChannelsOpen(true)

    try {
      const data = await api.post<ChannelsData>('/api/checker/channels', {
        url: result.url,
        check: false
      })
      setChannelsData(data)
      toast.success(`${data.channels.length} canales cargados`)
    } catch (err: any) {
      const msg = err?.message || 'Error al cargar canales'
      setChannelsError(msg)
      toast.error(msg)
      setChannelsOpen(false)
    } finally {
      setChannelsLoading(false)
    }
  }, [result.url, channelsData])

  const handleStartBulkCheck = useCallback(async () => {
    if (!channelsData) return

    setChannelsData(prev => {
      if (!prev) return null
      return {
        ...prev,
        channels: prev.channels.map(ch => ({ ...ch, health: 'checking', latencyMs: 0 })),
        summary: { total: prev.channels.length, online: 0, slow: 0, offline: 0 }
      }
    })

    setCheckingInProgress(true)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      const csrf = getCsrfToken()
      if (csrf) headers['X-CSRF-Token'] = csrf

      const response = await fetch('/api/checker/channels', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: result.url,
          check: true
        }),
      })

      if (!response.ok) {
        throw new Error('Error al iniciar la verificación')
      }

      if (!response.body) {
        throw new Error('Streaming response not supported by browser')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep the incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'update') {
              setChannelsData(prev => {
                if (!prev) return null
                const newChannels = [...prev.channels]
                if (newChannels[msg.index]) {
                  newChannels[msg.index] = {
                    ...newChannels[msg.index],
                    health: msg.health,
                    latencyMs: msg.latencyMs
                  }

                  let online = 0, slow = 0, offline = 0
                  for (const ch of newChannels) {
                    if (ch.health === 'online') online++
                    else if (ch.health === 'slow') slow++
                    else if (ch.health === 'offline') offline++
                  }

                  return {
                    channels: newChannels,
                    summary: { total: newChannels.length, online, slow, offline }
                  }
                }
                return prev
              })
            } else if (msg.type === 'done') {
              setChannelsData(prev => {
                if (!prev) return null
                return {
                  ...prev,
                  summary: msg.summary
                }
              })
              setCheckingInProgress(false)
              toast.success(`${msg.summary.total} canales verificados`)
            }
          } catch (e) {
            console.error('Failed to parse line:', line, e)
          }
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error durante la verificación')
      setCheckingInProgress(false)
    }
  }, [result.url, channelsData])

  const shortUrl = (() => {
    try {
      const u = new URL(result.url)
      return `${u.protocol}//${u.host}`
    } catch { return result.url.slice(0, 60) }
  })()

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-300 animate-fade-in-up overflow-hidden',
        isOnline
          ? 'border-emerald-500/20 bg-emerald-500/[0.03] hover:border-emerald-500/35'
          : 'border-red-500/20 bg-red-500/[0.03] hover:border-red-500/35'
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* ── Main row ───────────────────────────────────────────────────────── */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Status icon */}
          <div className={cn(
            'mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            isOnline ? 'bg-emerald-500/15' : 'bg-red-500/15'
          )}>
            {isOnline
              ? <Wifi className="w-4 h-4 text-emerald-400" />
              : <WifiOff className="w-4 h-4 text-red-400" />
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusBadge status={result.status} />
              <TypeBadge type={result.type} />
              {result.serverInfo?.isTrial && (
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10">
                  Trial
                </Badge>
              )}
            </div>
            <p
              className="text-sm text-muted-foreground font-mono truncate cursor-pointer hover:text-foreground transition-colors"
              title={result.url}
              onClick={handleCopyUrl}
            >
              {shortUrl}
            </p>
          </div>

          {/* Quick stats — desktop */}
          <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-sm">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Latencia</p>
              <p className={cn('font-mono font-semibold text-sm', getLatencyColor(result.responseTimeMs))}>
                {formatMs(result.responseTimeMs)}
              </p>
            </div>

            {result.channelCount !== null && (
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Canales</p>
                <p className="font-mono font-semibold text-sm text-foreground">{result.channelCount.toLocaleString()}</p>
              </div>
            )}

            {result.expiresAt && (
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Expira</p>
                <ExpiryBadge expiresAt={result.expiresAt} />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleCopyUrl}
              title="Copiar URL"
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>

            {/* Ver canales — only for online sources */}
            {isOnline && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 px-2.5 gap-1.5 text-xs font-medium transition-all rounded-md',
                  channelsOpen
                    ? 'text-primary bg-primary/10 hover:bg-primary/15'
                    : 'text-muted-foreground hover:text-foreground',
                  checkingInProgress && 'text-primary animate-pulse'
                )}
                onClick={handleLoadChannels}
                disabled={channelsLoading}
                title="Ver canales y su estado"
              >
                {channelsLoading || checkingInProgress ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <List className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">
                  {channelsLoading
                    ? 'Cargando...'
                    : checkingInProgress
                    ? 'Verificando...'
                    : channelsOpen
                    ? 'Ocultar'
                    : 'Ver canales'}
                </span>
                {channelsData && (
                  <span className={cn(
                    'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ml-0.5',
                    'bg-primary/20 text-primary'
                    )}>
                      {channelsData.summary.total}
                    </span>
                  )}
              </Button>
            )}

            {/* Server info toggle */}
            {result.serverInfo && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setInfoExpanded(e => !e)}
                title={infoExpanded ? 'Ocultar info' : 'Ver info del servidor'}
              >
                {infoExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            )}
          </div>
        </div>

        {/* Mobile stats */}
        <div className="sm:hidden flex items-center gap-4 mt-3 pl-11 text-sm flex-wrap">
          <span className={cn('flex items-center gap-1 font-mono text-xs', getLatencyColor(result.responseTimeMs))}>
            <Clock className="w-3 h-3" />
            {formatMs(result.responseTimeMs)}
          </span>
          {result.channelCount !== null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tv className="w-3 h-3" />
              {result.channelCount.toLocaleString()} canales
            </span>
          )}
          {result.expiresAt && <ExpiryBadge expiresAt={result.expiresAt} />}
        </div>

        {/* Error */}
        {result.error && (
          <div className="mt-3 ml-11 flex items-start gap-2 text-xs text-red-400/80 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10">
            <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{result.error}</span>
          </div>
        )}

        {/* Channels fetch error */}
        {channelsError && channelsOpen && (
          <div className="mt-3 ml-11 flex items-start gap-2 text-xs text-red-400/80 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10">
            <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>Error al cargar canales: {channelsError}</span>
          </div>
        )}
      </div>

      {/* ── Server info panel ──────────────────────────────────────────────── */}
      {infoExpanded && result.serverInfo && (
        <div className="border-t border-border/50 px-4 py-3 bg-muted/20">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5">
            <Info className="w-3 h-3" /> Información del servidor
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { label: 'Host',          value: result.serverInfo.url },
              { label: 'Usuario',       value: result.serverInfo.username },
              { label: 'Protocolo',     value: result.serverInfo.serverProtocol || '—' },
              { label: 'Puerto HTTP',   value: result.serverInfo.port || '—' },
              { label: 'Puerto HTTPS',  value: result.serverInfo.httpsPort || '—' },
              { label: 'Zona horaria',  value: result.serverInfo.timezone || '—' },
              {
                label: 'Conexiones',
                value: result.serverInfo.activeConnections !== null
                  ? `${result.serverInfo.activeConnections} / ${result.serverInfo.maxConnections ?? '∞'}`
                  : '—',
              },
              { label: 'Trial', value: result.serverInfo.isTrial ? 'Sí' : 'No' },
            ].map(({ label, value }) => (
              <div key={label} className="min-w-0">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</p>
                <p className="text-xs text-foreground font-mono truncate" title={String(value)}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Channel health panel ───────────────────────────────────────────── */}
      {channelsOpen && channelsData && !channelsLoading && (
        <ChannelHealthPanel
          data={channelsData}
          setData={setChannelsData}
          checkingInProgress={checkingInProgress}
          onStartBulkCheck={handleStartBulkCheck}
        />
      )}

      {/* Channels loading skeleton */}
      {channelsLoading && (
        <div className="border-t border-border/50 px-4 py-4 bg-muted/[0.08]">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Obteniendo y verificando canales...</span>
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-8 rounded-lg bg-muted/40 animate-pulse"
                style={{ animationDelay: `${i * 60}ms`, opacity: 1 - i * 0.12 }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Summary Bar ───────────────────────────────────────────────────────────────

function SummaryBar({ results }: { results: CheckResult[] }) {
  const online  = results.filter(r => r.status === 'online').length
  const offline = results.filter(r => r.status === 'offline').length
  const total   = results.length
  const avgMs   = results
    .filter(r => r.responseTimeMs > 0)
    .reduce((a, r, _, arr) => a + r.responseTimeMs / arr.length, 0)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: 'Total',             value: total,                                          icon: ShieldCheck,  color: 'text-primary',      bg: 'bg-primary/10' },
        { label: 'Online',            value: online,                                         icon: CheckCircle2, color: 'text-emerald-400',   bg: 'bg-emerald-500/10' },
        { label: 'Offline',           value: offline,                                        icon: XCircle,      color: 'text-red-400',       bg: 'bg-red-500/10' },
        { label: 'Latencia promedio', value: avgMs > 0 ? formatMs(Math.round(avgMs)) : '—', icon: Clock,        color: getLatencyColor(Math.round(avgMs)), bg: 'bg-muted/50' },
      ].map(({ label, value, icon: Icon, color, bg }) => (
        <Card key={label} className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
              <Icon className={cn('w-4 h-4', color)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('text-xl font-bold font-mono', color)}>{value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CheckerPage() {
  const [inputText, setInputText] = useState('')
  const [results, setResults]     = useState<CheckResult[]>([])
  const [loading, setLoading]     = useState(false)
  const textareaRef               = useRef<HTMLTextAreaElement>(null)

  const urlCount = parseUrls(inputText).length

  const handleCheck = async () => {
    const urls = parseUrls(inputText)
    if (urls.length === 0) {
      toast.error('Ingresá al menos una URL válida (http:// o https://)')
      return
    }
    if (urls.length > 20) {
      toast.error('Máximo 20 URLs por verificación')
      return
    }

    setLoading(true)
    setResults([])

    try {
      const data = await api.post<{ results: CheckResult[] }>('/api/checker/check', { urls })
      setResults(data.results)

      const online  = data.results.filter(r => r.status === 'online').length
      const offline = data.results.filter(r => r.status === 'offline').length
      toast.success(`Verificación completa: ${online} online, ${offline} offline`)
    } catch (err: any) {
      toast.error(err?.message || 'Error al verificar las URLs')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setInputText('')
    setResults([])
    textareaRef.current?.focus()
  }

  return (
    <div>
      <PageHeader
        title="IPTV Checker"
        subtitle="Verificá el estado de tus fuentes Xtream y M3U"
        icon={ShieldCheck}
        actions={
          results.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-muted-foreground">
              <Trash2 className="w-4 h-4 mr-2" />
              Limpiar
            </Button>
          )
        }
      />

      {/* Input card */}
      <Card className="mb-6 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
            <Wifi className="w-4 h-4 text-primary" />
            URLs a verificar
            <span className="ml-auto text-[11px] text-muted-foreground/60 font-normal">
              Soporta Xtream Codes y M3U · Máx. 20
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
              id="checker-input"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCheck()
              }}
              placeholder={`Pegá una o varias URLs separadas por espacios o saltos de línea:

http://servidor.com:8080/player_api.php?username=user&password=pass
http://servidor.com:8080/get.php?username=user&password=pass&type=m3u_plus
http://otro-panel.tv:25461/user/pass/...`}
              rows={6}
              className={cn(
                'w-full resize-none rounded-xl border border-border bg-muted/30 px-4 py-3',
                'text-sm font-mono text-foreground placeholder:text-muted-foreground/40',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40',
                'transition-all duration-200'
              )}
              disabled={loading}
              spellCheck={false}
            />
            {urlCount > 0 && (
              <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-primary/15 text-primary text-xs font-semibold">
                {urlCount} URL{urlCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground/60">
              Tip: Ctrl+Enter para verificar rápido
            </p>
            <div className="flex items-center gap-2">
              {inputText && (
                <Button variant="ghost" size="sm" onClick={handleClear} className="text-muted-foreground h-8">
                  Limpiar
                </Button>
              )}
              <Button
                id="checker-submit"
                onClick={handleCheck}
                disabled={loading || urlCount === 0}
                className="h-8 px-4 gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Verificar{urlCount > 0 ? ` (${urlCount})` : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 mb-6">
          {parseUrls(inputText).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-xl border border-border/40 bg-muted/20 animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && results.length > 0 && (
        <>
          <SummaryBar results={results} />
          <div className="space-y-3">
            {results.map((result, i) => (
              <ResultCard key={result.url + i} result={result} index={i} />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && inputText.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8 text-primary/60" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Verificador de fuentes IPTV</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Ingresá URLs de Xtream Codes o M3U para verificar si están online,
            ver el tiempo de respuesta, cantidad de canales y fecha de expiración.
            En las fuentes online podés ver el estado de cada canal individualmente.
          </p>
        </div>
      )}
    </div>
  )
}
