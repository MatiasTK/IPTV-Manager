import { useState, useCallback, useEffect, useMemo } from 'react'
import { Loader2, Copy, RefreshCw, Search, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router'
import { PageHeader } from '@/components/shared/page-header'
import { StatStrip, type StatItem } from '@/components/shared/stat-strip'
import { FilterChips } from '@/components/shared/filter-chips'
import { StatusLabel } from '@/components/shared/health-badge'
import { LatencyBar } from '@/components/shared/latency-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LinkExtractor } from '@/components/checker/link-extractor'
import { SortableHead, compareValues, nextSort, type SortState } from '@/components/shared/sortable-head'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, getCsrfToken } from '@/lib/api'
import { STATUS_COLOR } from '@/lib/status'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { HealthStatus } from '@/lib/types'

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

export interface CheckResult {
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

type InputMode = 'xtream' | 'm3u' | 'batch' | 'extract'

interface RecentCheck {
  host: string
  type: 'xtream' | 'm3u'
  result: string
  ok: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RECENTS_KEY = 'iptv-checker-recents'

function loadRecents(): RecentCheck[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 5) : []
  } catch { return [] }
}

function saveRecents(list: RecentCheck[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 5))) } catch { /* sin storage */ }
}

function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch { return url.slice(0, 60) }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch { return '—' }
}

function formatMs(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
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

function buildXtreamUrl(host: string, user: string, pass: string): string {
  const base = host.trim().replace(/\/+$/, '')
  return `${base}/player_api.php?username=${encodeURIComponent(user.trim())}&password=${encodeURIComponent(pass)}`
}

const HEALTH_MAP: Record<ChannelHealth, HealthStatus> = {
  online: 'healthy',
  slow: 'degraded',
  offline: 'down',
  checking: 'unknown',
  unknown: 'unknown',
}

function ChannelStatus({ health }: { health: ChannelHealth }) {
  if (health === 'checking') {
    return (
      <span className="inline-flex animate-pulse items-center gap-2 font-mono text-xs whitespace-nowrap text-primary">
        <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        VERIFICANDO
      </span>
    )
  }
  return <StatusLabel status={HEALTH_MAP[health]} />
}

// ── Channel Health Panel ───────────────────────────────────────────────────────

type HealthFilter = 'all' | ChannelHealth

interface ChannelHealthPanelProps {
  data: ChannelsData
  setData: React.Dispatch<React.SetStateAction<ChannelsData | null>>
  checkingInProgress: boolean
  onStartBulkCheck: () => Promise<void>
}

const PAGE_SIZE = 100

type ChannelSortKey = 'name' | 'group' | 'health' | 'latency'
const HEALTH_RANK: Record<ChannelHealth, number> = { online: 0, slow: 1, checking: 2, unknown: 3, offline: 4 }

function ChannelHealthPanel({ data, setData, checkingInProgress, onStartBulkCheck }: ChannelHealthPanelProps) {
  const [filter, setFilter]   = useState<HealthFilter>('all')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const [sort, setSort]       = useState<SortState<ChannelSortKey> | null>(null)

  const { channels, summary } = data

  const matching = channels.filter(ch => {
    if (filter !== 'all' && ch.health !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return ch.name.toLowerCase().includes(q) || ch.group.toLowerCase().includes(q)
    }
    return true
  })

  const filtered = useMemo(() => {
    if (!sort) return matching
    const val = (c: ChannelEntry) =>
      sort.key === 'health' ? HEALTH_RANK[c.health]
      : sort.key === 'latency' ? (c.health === 'online' || c.health === 'slow' ? c.latencyMs : null)
      : c[sort.key]
    return [...matching].sort((a, b) => compareValues(val(a), val(b), sort.dir))
  }, [channels, filter, search, sort])

  // Reset to first page on search or filter change
  useEffect(() => {
    setPage(1)
  }, [filter, search])

  const onSort = (k: ChannelSortKey) => { setSort(s => nextSort(s, k)); setPage(1) }

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

  const chips: { value: HealthFilter; label: string; count: number; color: string }[] = [
    { value: 'all',      label: 'Todos',         count: summary.total,   color: '#E7E9EC' },
    { value: 'online',   label: 'Online',        count: summary.online,  color: STATUS_COLOR.healthy },
    { value: 'slow',     label: 'Lento',         count: summary.slow,    color: STATUS_COLOR.degraded },
    { value: 'offline',  label: 'Caído',         count: summary.offline, color: STATUS_COLOR.down },
    { value: 'checking', label: 'Verificando',   count: checkingCount,   color: '#F2A33A' },
    { value: 'unknown',  label: 'Sin verificar', count: unknownCount,    color: STATUS_COLOR.unknown },
  ]
  const visibleChips = chips.filter(c => c.value === 'all' || c.count > 0 || c.value === filter)

  return (
    <div className="flex flex-col gap-4 border-t border-border p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <FilterChips label="Estado de los canales" options={visibleChips} value={filter} onChange={setFilter} />
        <label className="flex h-11 min-w-[200px] flex-[1_1_220px] items-center gap-2.5 rounded-lg border border-control bg-card px-3.5 hover:border-control-strong focus-within:border-control-strong">
          <Search aria-hidden="true" className="size-4 shrink-0 text-label" />
          <span className="sr-only">Buscar canal</span>
          <input
            type="text"
            placeholder="Buscar canal…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
        <Button variant="secondary" onClick={onStartBulkCheck} disabled={checkingInProgress}>
          {checkingInProgress && <Loader2 aria-hidden="true" className="animate-spin" />}
          {checkingInProgress ? 'Verificando...' : 'Verificar todos'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-border bg-card">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead label="Canal" sortKey="name" sort={sort} onSort={onSort} />
              <SortableHead label="Categoría" sortKey="group" sort={sort} onSort={onSort} />
              <SortableHead label="Estado" sortKey="health" sort={sort} onSort={onSort} />
              <SortableHead label="Latencia" sortKey="latency" sort={sort} onSort={onSort} />
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-sm text-label">
                  No se encontraron canales{search ? ` para "${search}"` : ''}
                </TableCell>
              </TableRow>
            ) : paginated.map((ch, i) => (
              <TableRow key={ch.url + i}>
                <TableCell className="max-w-[320px]">
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted font-mono text-[10px] text-[#C9CED4]">
                      {ch.logo ? (
                        <img
                          src={ch.logo}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="size-full object-contain"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : ch.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="truncate font-semibold" title={ch.name}>{ch.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{ch.group || '—'}</TableCell>
                <TableCell><ChannelStatus health={ch.health} /></TableCell>
                <TableCell>
                  {ch.health === 'checking' || ch.health === 'unknown'
                    ? <span className="font-mono text-xs text-label">—</span>
                    : <LatencyBar status={HEALTH_MAP[ch.health]} ms={ch.latencyMs} />}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={`Verificar ${ch.name}`}
                      onClick={() => handleProbeChannel(ch.url)}
                      disabled={checkingInProgress || ch.health === 'checking'}
                    >
                      {ch.health === 'checking'
                        ? <Loader2 aria-hidden="true" className="animate-spin" />
                        : <RefreshCw aria-hidden="true" />}
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={`Copiar URL de ${ch.name}`}
                      onClick={() => {
                        navigator.clipboard.writeText(ch.url)
                        toast.success('Enlace de canal copiado')
                      }}
                    >
                      <Copy aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-[13px] text-label">
          <span className="font-mono">
            {((safePage - 1) * PAGE_SIZE + 1).toLocaleString('es-AR')}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString('es-AR')} de {filtered.length.toLocaleString('es-AR')}
            {filtered.length < channels.length ? ` (de ${channels.length.toLocaleString('es-AR')})` : ''}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">Pág. {safePage} / {totalPages}</span>
              <Button variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>Anterior</Button>
              <Button variant="secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Siguiente</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Result Card ───────────────────────────────────────────────────────────────

export interface ImportPrefill {
  type: 'url' | 'xtream'
  name: string
  url?: string
  host?: string
  user?: string
  pass?: string
}

function toPrefill(result: CheckResult): ImportPrefill {
  const name = hostOf(result.url).replace(/^https?:\/\//, '')
  if (result.type === 'xtream') {
    try {
      const u = new URL(result.url)
      return {
        type: 'xtream',
        name,
        host: `${u.protocol}//${u.host}`,
        user: u.searchParams.get('username') ?? '',
        pass: u.searchParams.get('password') ?? '',
      }
    } catch { /* cae a url */ }
  }
  return { type: 'url', name, url: result.url }
}

function ResultCard({ result, rechecking, onRecheck }: { result: CheckResult; rechecking: boolean; onRecheck: () => void }) {
  const navigate = useNavigate()
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

  const shortUrl = hostOf(result.url)

  const expired = isExpired(result.expiresAt)
  const soon = isExpiringSoon(result.expiresAt)
  const checked = channelsData ? channelsData.summary.online + channelsData.summary.slow + channelsData.summary.offline : 0
  const onlinePct = channelsData && checked > 0 ? Math.round((channelsData.summary.online / checked) * 100) : null
  const si = result.serverInfo

  const account: StatItem[] = [
    {
      key: 'account',
      label: 'Cuenta',
      value: !isOnline ? 'OFFLINE' : expired ? 'EXPIRADA' : result.type === 'xtream' ? 'ACTIVA' : 'ONLINE',
      color: !isOnline || expired ? STATUS_COLOR.down : STATUS_COLOR.healthy,
    },
    { key: 'latency', label: 'Latencia', value: formatMs(result.responseTimeMs) },
    ...(result.expiresAt
      ? [{ key: 'expires', label: 'Expira', value: formatDate(result.expiresAt), color: expired ? STATUS_COLOR.down : soon ? STATUS_COLOR.degraded : '#E7E9EC' }]
      : []),
    ...(si && si.activeConnections !== null
      ? [{ key: 'conn', label: 'Conexiones', value: `${si.activeConnections} / ${si.maxConnections ?? '∞'}` }]
      : []),
    ...(result.channelCount !== null ? [{ key: 'channels', label: 'Canales', value: result.channelCount.toLocaleString('es-AR') }] : []),
    ...(onlinePct !== null
      ? [{ key: 'online', label: 'Online', value: `${onlinePct}%`, color: onlinePct >= 70 ? STATUS_COLOR.healthy : onlinePct >= 40 ? STATUS_COLOR.degraded : STATUS_COLOR.down }]
      : []),
  ]

  return (
    <article className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusLabel status={isOnline ? 'healthy' : 'down'} />
            <span className="rounded border border-control px-[7px] py-[3px] font-mono text-[10px] tracking-[0.08em] text-[#C9CED4] uppercase">
              {result.type}
            </span>
            {si?.isTrial && (
              <span className="rounded border border-control px-[7px] py-[3px] font-mono text-[10px] tracking-[0.08em] text-degraded">
                TRIAL
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopyUrl}
            title={`${result.url} — clic para copiar`}
            className="max-w-full truncate text-left font-mono text-[13px] text-muted-foreground hover:text-foreground"
          >
            {shortUrl}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="icon" onClick={handleCopyUrl} aria-label="Copiar URL">
            <Copy aria-hidden="true" />
          </Button>
          <Button variant="secondary" onClick={onRecheck} disabled={rechecking || checkingInProgress}>
            {rechecking ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
            {rechecking ? 'Verificando...' : 'Verificar'}
          </Button>
          {si && (
            <Button
              variant="secondary"
              onClick={() => setInfoExpanded(e => !e)}
              aria-expanded={infoExpanded}
            >
              {infoExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              Info del servidor
            </Button>
          )}
          {isOnline && (
            <Button variant="secondary" onClick={() => navigate('/sources', { state: { importPrefill: toPrefill(result) } })}>
              Importar como fuente
            </Button>
          )}
          {isOnline && (
            <Button onClick={handleLoadChannels} disabled={channelsLoading}>
              {(channelsLoading || checkingInProgress) && <Loader2 aria-hidden="true" className="animate-spin" />}
              {channelsLoading ? 'Cargando...' : checkingInProgress ? 'Verificando...' : channelsOpen ? 'Ocultar canales' : 'Ver canales'}
            </Button>
          )}
        </div>
      </div>

      <StatStrip items={account} label="Cuenta" compact className="rounded-none border-x-0 border-b-0" />

      {result.error && (
        <p role="alert" className="border-t border-border px-5 py-3 text-[13px] text-destructive">
          {result.error}
        </p>
      )}
      {channelsError && channelsOpen && (
        <p role="alert" className="border-t border-border px-5 py-3 text-[13px] text-destructive">
          Error al cargar canales: {channelsError}
        </p>
      )}

      {infoExpanded && si && (
        <dl className="grid grid-cols-2 gap-4 border-t border-border px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: 'Host',          value: si.url },
            { label: 'Usuario',       value: si.username },
            { label: 'Protocolo',     value: si.serverProtocol || '—' },
            { label: 'Puerto HTTP',   value: si.port || '—' },
            { label: 'Puerto HTTPS',  value: si.httpsPort || '—' },
            { label: 'Zona horaria',  value: si.timezone || '—' },
            { label: 'Trial',         value: si.isTrial ? 'Sí' : 'No' },
          ].map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] tracking-[0.08em] text-label uppercase">{label}</dt>
              <dd className="truncate font-mono text-[13px]" title={String(value)}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {channelsOpen && channelsData && !channelsLoading && (
        <ChannelHealthPanel
          data={channelsData}
          setData={setChannelsData}
          checkingInProgress={checkingInProgress}
          onStartBulkCheck={handleStartBulkCheck}
        />
      )}

      {channelsLoading && (
        <div role="status" className="flex items-center gap-2 border-t border-border px-5 py-4">
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary" />
          <span className="text-[13px] text-muted-foreground">Obteniendo canales...</span>
        </div>
      )}
    </article>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CheckerPage() {
  const navigate = useNavigate()
  const [mode, setMode]           = useState<InputMode>('xtream')
  const [xtHost, setXtHost]       = useState('')
  const [xtUser, setXtUser]       = useState('')
  const [xtPass, setXtPass]       = useState('')
  const [m3uUrl, setM3uUrl]       = useState('')
  const [batchText, setBatchText] = useState('')
  const [results, setResults]     = useState<CheckResult[]>([])
  const [loading, setLoading]     = useState(false)
  const [recents, setRecents]     = useState<RecentCheck[]>(loadRecents)
  const [recheckingUrl, setRecheckingUrl] = useState<string | null>(null)

  const urls = useMemo(() => {
    if (mode === 'xtream') {
      return xtHost.trim() && xtUser.trim() && xtPass ? [buildXtreamUrl(xtHost, xtUser, xtPass)] : []
    }
    if (mode === 'm3u') return parseUrls(m3uUrl).slice(0, 1)
    return parseUrls(batchText)
  }, [mode, xtHost, xtUser, xtPass, m3uUrl, batchText])

  const handleCheck = async () => {
    if (urls.length === 0) {
      toast.error(mode === 'batch' ? 'Ingresá al menos una URL válida (http:// o https://)' : 'Completá los datos de la fuente')
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

      // Recientes: solo se guarda el host, nunca usuario/contraseña ni tokens
      const fresh: RecentCheck[] = data.results.map(r => ({
        host: hostOf(r.url),
        type: r.type,
        ok: r.status === 'online',
        result: r.status === 'online'
          ? (isExpired(r.expiresAt) ? 'Expirada' : `Activa${r.channelCount !== null ? ` · ${r.channelCount.toLocaleString('es-AR')} canales` : ''}`)
          : 'Offline',
      }))
      const next = [...fresh, ...recents.filter(x => !fresh.some(f => f.host === x.host))].slice(0, 5)
      setRecents(next)
      saveRecents(next)
    } catch (err: any) {
      toast.error(err?.message || 'Error al verificar las URLs')
    } finally {
      setLoading(false)
    }
  }

  const handleRecheck = async (url: string) => {
    setRecheckingUrl(url)
    try {
      const data = await api.post<{ results: CheckResult[] }>('/api/checker/check', { urls: [url] })
      const fresh = data.results[0]
      if (fresh) {
        setResults(prev => prev.map(r => (r.url === url ? fresh : r)))
        toast.success(fresh.status === 'online' ? 'Servidor online' : 'Servidor offline')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error al verificar el servidor')
    } finally {
      setRecheckingUrl(null)
    }
  }

  const handleClear = () => {
    setXtHost(''); setXtUser(''); setXtPass('')
    setM3uUrl('')
    setBatchText('')
    setResults([])
  }

  const applyRecent = (r: RecentCheck) => {
    setResults([])
    if (r.type === 'xtream') { setMode('xtream'); setXtHost(r.host) }
    else { setMode('m3u'); setM3uUrl(r.host) }
  }

  const fieldLabel = 'text-[13px] font-normal text-muted-foreground'
  const idle = !loading && results.length === 0 && mode !== 'extract'

  return (
    <>
      <PageHeader
        title="IPTV Checker"
        subtitle="Probá una cuenta Xtream o una lista M3U antes de importarla."
        status="VERIFICADOR DE FUENTES"
        actions={
          results.length > 0 && (
            <>
              <Button variant="secondary" onClick={handleClear}>Limpiar</Button>
            </>
          )
        }
      />

      <section aria-label="Datos de la fuente" className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card px-5 py-[18px]">
        <Tabs value={mode} onValueChange={v => setMode(v as InputMode)}>
          <TabsList aria-label="Tipo de fuente">
            <TabsTrigger value="xtream">Xtream</TabsTrigger>
            <TabsTrigger value="m3u">M3U</TabsTrigger>
            <TabsTrigger value="batch">Varias URLs</TabsTrigger>
            <TabsTrigger value="extract">Extraer de archivo</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'extract' && (
          <LinkExtractor onImport={r => navigate('/sources', { state: { importPrefill: toPrefill(r) } })} />
        )}

        {mode !== 'extract' && <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => { e.preventDefault(); handleCheck() }}
        >
          {mode === 'xtream' && (
            <>
              <div className="flex flex-[2_1_260px] flex-col gap-1.5">
                <Label htmlFor="chk-host" className={fieldLabel}>Servidor</Label>
                <Input id="chk-host" value={xtHost} onChange={e => setXtHost(e.target.value)} placeholder="http://servidor.com:8080" className="font-mono text-[13px]" disabled={loading} />
              </div>
              <div className="flex flex-[1_1_160px] flex-col gap-1.5">
                <Label htmlFor="chk-user" className={fieldLabel}>Usuario</Label>
                <Input id="chk-user" value={xtUser} onChange={e => setXtUser(e.target.value)} placeholder="usuario123" autoComplete="username" disabled={loading} />
              </div>
              <div className="flex flex-[1_1_160px] flex-col gap-1.5">
                <Label htmlFor="chk-pass" className={fieldLabel}>Contraseña</Label>
                <Input id="chk-pass" type="password" value={xtPass} onChange={e => setXtPass(e.target.value)} placeholder="••••••" autoComplete="current-password" disabled={loading} />
              </div>
            </>
          )}
          {mode === 'm3u' && (
            <div className="flex flex-[1_1_480px] flex-col gap-1.5">
              <Label htmlFor="chk-m3u" className={fieldLabel}>URL de la lista M3U</Label>
              <Input id="chk-m3u" value={m3uUrl} onChange={e => setM3uUrl(e.target.value)} placeholder="https://…/lista.m3u" className="font-mono text-[13px]" disabled={loading} />
            </div>
          )}
          {mode === 'batch' && (
            <div className="flex flex-[1_1_100%] flex-col gap-1.5">
              <Label htmlFor="chk-batch" className={fieldLabel}>URLs a verificar (separadas por espacios o saltos de línea · máx. 20)</Label>
              <Textarea
                id="chk-batch"
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCheck() }}
                rows={5}
                spellCheck={false}
                disabled={loading}
                placeholder={'http://servidor.com:8080/player_api.php?username=user&password=pass\nhttp://servidor.com:8080/get.php?username=user&password=pass&type=m3u_plus'}
                className="font-mono text-xs"
              />
            </div>
          )}
          <Button type="submit" size="lg" disabled={loading || urls.length === 0} className="px-[22px]">
            {loading && <Loader2 aria-hidden="true" className="animate-spin" />}
            {loading ? 'Verificando...' : `Verificar${urls.length > 1 ? ` (${urls.length})` : ''}`}
          </Button>
        </form>}
      </section>

      {loading && mode !== 'extract' && (
        <div role="status" aria-label="Verificando" className="flex flex-col gap-3">
          {urls.map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[10px] border border-border bg-card" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      )}

      {idle && (
        <section aria-label="Verificaciones recientes" className="flex flex-col gap-2.5 rounded-[10px] border border-dashed border-control p-5">
          <span className="text-xs tracking-[0.08em] text-label uppercase">Recientes</span>
          {recents.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-label" />
              Todavía no verificaste ninguna fuente. Ingresá los datos arriba para ver si está online, cuándo expira y el estado de cada canal.
            </div>
          ) : (
            recents.map(r => (
              <button
                key={r.host}
                type="button"
                onClick={() => applyRecent(r)}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 text-left transition-colors hover:bg-raised"
              >
                <span className="truncate font-mono text-[13px]">{r.host}</span>
                <span className={cn('shrink-0 text-xs')} style={{ color: r.ok ? (r.result.startsWith('Expirada') ? STATUS_COLOR.down : STATUS_COLOR.healthy) : STATUS_COLOR.down }}>
                  {r.result}
                </span>
              </button>
            ))
          )}
        </section>
      )}

      {!loading && results.length > 0 && mode !== 'extract' && (
        <div className="flex flex-col gap-[22px]">
          {results.map((result, i) => (
            <ResultCard
              key={result.url + i}
              result={result}
              rechecking={recheckingUrl === result.url}
              onRecheck={() => handleRecheck(result.url)}
            />
          ))}
        </div>
      )}
    </>
  )
}
