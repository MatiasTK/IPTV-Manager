import { useMemo, useRef, useState } from 'react'
import { Copy, Eye, FileText, Loader2, RefreshCw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterChips } from '@/components/shared/filter-chips'
import { StatStrip } from '@/components/shared/stat-strip'
import { SortableHead, compareValues, nextSort, type SortState } from '@/components/shared/sortable-head'
import { ChannelPreviewDialog } from '@/components/checker/channel-preview-dialog'
import { StatusLabel } from '@/components/shared/health-badge'
import { api } from '@/lib/api'
import { STATUS_COLOR } from '@/lib/status'
import { extractFromFile, extractFromText, type ExtractedLink } from '@/lib/extract-links'
import type { CheckResult } from '@/pages/checker'

interface Row {
  link: ExtractedLink
  result?: CheckResult
}

type SortKey = 'host' | 'type' | 'user' | 'status' | 'expires' | 'channels'
type Filter = 'all' | 'online' | 'offline' | 'pending'

const BATCH_SIZE = 20   // máximo que acepta /api/checker/check
const PARALLEL_BATCHES = 3
const PAGE_SIZE = 100

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

interface Props {
  onImport: (result: CheckResult) => void
}

export function LinkExtractor({ onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const cancelCheckRef = useRef(false)

  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [foundSoFar, setFoundSoFar] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortState<SortKey> | null>(null)
  const [preview, setPreview] = useState<ExtractedLink | null>(null)
  const [probing, setProbing] = useState<Set<string>>(new Set())

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setExtracting(true)
    setProgress(0)
    setFoundSoFar(0)
    setRows([])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const links = await extractFromFile(file, (p, n) => { setProgress(p); setFoundSoFar(n) }, ctrl.signal)
      setRows(links.map(link => ({ link })))
      setFilter('all'); setPage(1)
      toast[links.length ? 'success' : 'info'](links.length ? `${links.length.toLocaleString('es-AR')} enlaces encontrados` : 'No se encontraron enlaces')
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo leer el archivo')
    } finally {
      setExtracting(false)
      abortRef.current = null
    }
  }

  const handleExtractText = () => {
    const found = new Map<string, ExtractedLink>()
    extractFromText(text, found)
    const links = [...found.values()]
    setFileName(null)
    setRows(links.map(link => ({ link })))
    setFilter('all'); setPage(1)
    toast[links.length ? 'success' : 'info'](links.length ? `${links.length.toLocaleString('es-AR')} enlaces encontrados` : 'No se encontraron enlaces')
  }

  const handleCheckOne = async (link: ExtractedLink) => {
    setProbing(prev => new Set(prev).add(link.key))
    try {
      const data = await api.post<{ results: CheckResult[] }>('/api/checker/check', { urls: [link.url] })
      const result = data.results[0]
      if (result) setRows(prev => prev.map(r => (r.link.key === link.key ? { ...r, result } : r)))
    } catch (err: any) {
      toast.error(err?.message || 'Error al verificar el enlace')
    } finally {
      setProbing(prev => { const n = new Set(prev); n.delete(link.key); return n })
    }
  }

  const handleCheckAll = async () => {
    const pending = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.result)
    if (pending.length === 0) return
    cancelCheckRef.current = false
    setChecking(true)
    setChecked(0)

    const batches: { r: Row; i: number }[][] = []
    for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE))

    let next = 0
    const worker = async () => {
      while (!cancelCheckRef.current) {
        const batch = batches[next++]
        if (!batch) return
        try {
          const data = await api.post<{ results: CheckResult[] }>('/api/checker/check', { urls: batch.map(b => b.r.link.url) })
          setRows(prev => {
            const copy = [...prev]
            batch.forEach((b, k) => { if (data.results[k]) copy[b.i] = { ...copy[b.i], result: data.results[k] } })
            return copy
          })
        } catch (err: any) {
          toast.error(err?.message || 'Error al verificar un lote')
          cancelCheckRef.current = true
          return
        }
        setChecked(c => c + batch.length)
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_BATCHES }, worker))
    setChecking(false)
    toast.success(cancelCheckRef.current ? 'Verificación detenida' : 'Verificación completa')
  }

  const counts = useMemo(() => {
    let xtream = 0, m3u = 0, online = 0, offline = 0, pending = 0
    for (const r of rows) {
      if (r.link.type === 'xtream') xtream++; else m3u++
      if (!r.result) pending++
      else if (r.result.status === 'online') online++
      else offline++
    }
    return { xtream, m3u, online, offline, pending }
  }, [rows])

  const visible = useMemo(() => {
    const list = rows.filter(r => {
      if (filter === 'all') return true
      if (filter === 'pending') return !r.result
      return r.result?.status === filter
    })
    if (sort) {
      const val = (r: Row): string | number | null => {
        switch (sort.key) {
          case 'host': return r.link.host.replace(/^https?:\/\//, '')
          case 'type': return r.link.type
          case 'user': return r.link.user ?? null
          case 'status': return r.result ? (r.result.status === 'online' ? 0 : 2) : 1
          case 'expires': return r.result?.expiresAt ? new Date(r.result.expiresAt).getTime() : null
          case 'channels': return r.result?.channelCount ?? null
        }
      }
      return [...list].sort((a, b) => compareValues(val(a), val(b), sort.dir))
    }
    // por defecto: online primero, luego pendientes, luego caídos
    const rank = (r: Row) => (r.result ? (r.result.status === 'online' ? 0 : 2) : 1)
    return filter === 'all' ? [...list].sort((a, b) => rank(a) - rank(b)) : list
  }, [rows, filter, sort])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const copyOnline = () => {
    const lines = rows.filter(r => r.result?.status === 'online').map(r => r.link.url)
    navigator.clipboard.writeText(lines.join('\n'))
    toast.success(`${lines.length} enlaces online copiados`)
  }

  const chips: { value: Filter; label: string; count: number; color: string }[] = [
    { value: 'all', label: 'Todos', count: rows.length, color: '#E7E9EC' },
    { value: 'online', label: 'Online', count: counts.online, color: STATUS_COLOR.healthy },
    { value: 'offline', label: 'Caídos', count: counts.offline, color: STATUS_COLOR.down },
    { value: 'pending', label: 'Sin verificar', count: counts.pending, color: STATUS_COLOR.unknown },
  ]
  const visibleChips = chips.filter(c => c.value === 'all' || c.count > 0 || c.value === filter)

  const onSort = (k: SortKey) => { setSort(s => nextSort(s, k)); setPage(1) }

  const busy = extracting || checking

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-[1_1_100%] flex-col gap-1.5">
          <Label htmlFor="ext-text" className="text-[13px] font-normal text-muted-foreground">
            Pegá texto con enlaces, o cargá un archivo (.txt, .m3u, .csv…) de cualquier tamaño
          </Label>
          <Textarea
            id="ext-text"
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            spellCheck={false}
            disabled={busy}
            placeholder={'http://servidor.com:8080/get.php?username=user&password=pass&type=m3u_plus\nHost: http://servidor.com:8080  User: user  Pass: pass\nhttps://sitio.com/lista.m3u'}
            className="font-mono text-xs"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept=".txt,.m3u,.m3u8,.csv,.log,.json,.html,text/*"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />
        <Button type="button" variant="secondary" size="lg" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload aria-hidden="true" /> Cargar archivo
        </Button>
        <Button type="button" size="lg" onClick={handleExtractText} disabled={busy || !text.trim()} className="px-[22px]">
          Extraer enlaces
        </Button>
      </div>

      {extracting && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3.5">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary" />
              <span className="truncate">Analizando {fileName}…</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-label">
              {Math.round(progress * 100)}% · {foundSoFar.toLocaleString('es-AR')} enlaces
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>Cancelar</Button>
          </div>
        </div>
      )}

      {rows.length > 0 && !extracting && (
        <>
          <StatStrip
            label="Enlaces encontrados"
            compact
            items={[
              { key: 'total', label: fileName ? 'Archivo' : 'Texto', value: `${rows.length.toLocaleString('es-AR')} enlaces` },
              { key: 'xtream', label: 'Xtream', value: counts.xtream.toLocaleString('es-AR') },
              { key: 'm3u', label: 'M3U', value: counts.m3u.toLocaleString('es-AR') },
              { key: 'online', label: 'Online', value: counts.online.toLocaleString('es-AR'), color: counts.online ? STATUS_COLOR.healthy : undefined },
              { key: 'offline', label: 'Caídos', value: counts.offline.toLocaleString('es-AR'), color: counts.offline ? STATUS_COLOR.down : undefined },
            ]}
          />

          <div className="flex flex-wrap items-center gap-2.5">
            <FilterChips label="Estado de los enlaces" options={visibleChips} value={filter} onChange={v => { setFilter(v); setPage(1) }} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {checking && (
                <span className="font-mono text-xs text-label">
                  {checked.toLocaleString('es-AR')} / {(counts.pending + checked).toLocaleString('es-AR')}
                </span>
              )}
              {counts.online > 0 && (
                <Button variant="secondary" onClick={copyOnline}>
                  <Copy aria-hidden="true" /> Copiar online
                </Button>
              )}
              {checking ? (
                <Button variant="secondary" onClick={() => { cancelCheckRef.current = true }}>Detener</Button>
              ) : (
                <Button onClick={handleCheckAll} disabled={counts.pending === 0}>
                  {counts.pending === 0 ? 'Todo verificado' : `Verificar ${counts.pending.toLocaleString('es-AR')}`}
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-border bg-card">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead label="Servidor" sortKey="host" sort={sort} onSort={onSort} />
                  <SortableHead label="Tipo" sortKey="type" sort={sort} onSort={onSort} />
                  <SortableHead label="Usuario" sortKey="user" sort={sort} onSort={onSort} />
                  <SortableHead label="Estado" sortKey="status" sort={sort} onSort={onSort} />
                  <SortableHead label="Expira" sortKey="expires" sort={sort} onSort={onSort} />
                  <SortableHead label="Canales" sortKey="channels" sort={sort} onSort={onSort} />
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-label">Sin resultados</TableCell>
                  </TableRow>
                ) : pageRows.map(({ link, result }) => (
                  <TableRow key={link.key}>
                    <TableCell className="max-w-[300px]">
                      <span className="block truncate font-mono text-[13px]" title={link.url}>{link.host.replace(/^https?:\/\//, '')}</span>
                    </TableCell>
                    <TableCell>
                      <span className="rounded border border-control px-[7px] py-[3px] font-mono text-[10px] tracking-[0.08em] text-[#C9CED4] uppercase">{link.type}</span>
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate font-mono text-xs text-muted-foreground">{link.user ?? '—'}</TableCell>
                    <TableCell>
                      {probing.has(link.key)
                        ? <span className="inline-flex animate-pulse items-center gap-2 font-mono text-xs text-primary"><span aria-hidden="true" className="size-2 rounded-full bg-primary" />VERIFICANDO</span>
                        : result
                        ? <StatusLabel status={result.status === 'online' ? 'healthy' : 'down'} />
                        : <span className="font-mono text-xs text-label">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(result?.expiresAt ?? null)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {result?.channelCount != null ? result.channelCount.toLocaleString('es-AR') : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="secondary" size="icon-sm" aria-label={`Previsualizar ${link.host}`}
                          onClick={() => setPreview(link)}
                        >
                          <Eye aria-hidden="true" />
                        </Button>
                        <Button
                          variant="secondary" size="icon-sm" aria-label={`Verificar ${link.host}`}
                          onClick={() => handleCheckOne(link)}
                          disabled={probing.has(link.key)}
                        >
                          {probing.has(link.key) ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
                        </Button>
                        <Button
                          variant="secondary" size="icon-sm" aria-label={`Copiar URL de ${link.host}`}
                          onClick={() => { navigator.clipboard.writeText(link.url); toast.success('URL copiada') }}
                        >
                          <Copy aria-hidden="true" />
                        </Button>
                        {result?.status === 'online' && (
                          <Button variant="secondary" onClick={() => onImport(result)}>Importar</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 text-[13px] text-label">
            <span className="font-mono">{visible.length.toLocaleString('es-AR')} enlaces</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">Pág. {safePage} / {totalPages}</span>
                <Button variant="secondary" onClick={() => setPage(safePage - 1)} disabled={safePage === 1}>Anterior</Button>
                <Button variant="secondary" onClick={() => setPage(safePage + 1)} disabled={safePage === totalPages}>Siguiente</Button>
              </div>
            )}
          </div>
        </>
      )}

      {rows.length === 0 && !extracting && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <FileText aria-hidden="true" className="size-5 shrink-0 text-label" />
          Se detectan URLs con usuario/contraseña (get.php, player_api.php, /live/user/pass/…), listas .m3u y bloques “Host / User / Pass”. El archivo se procesa en tu navegador.
        </div>
      )}
      <ChannelPreviewDialog url={preview?.url ?? null} title={preview?.host ?? ''} onClose={() => setPreview(null)} />
    </div>
  )
}
