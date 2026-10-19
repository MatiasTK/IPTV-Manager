import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { Link as LinkIcon, Plus, RefreshCw, Pencil, Trash2, Loader2, Eye, EyeOff, Activity, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useSources, useUpdateSource, useDeleteSource, useSyncSource, useVerifySource,
  usePreviewSource, useImportUrl, useImportText, useImportXtream,
} from '@/hooks/use-sources'
import { useHealthStatus, useHealthBreakdown, useCheckNow, useCancelCheck } from '@/hooks/use-health'
import { STATUS_COLOR } from '@/lib/status'
import { ImportPreviewDialog } from '@/components/sources/ImportPreviewDialog'
import { ExcludedGroupsEditor } from '@/components/sources/ExcludedGroupsEditor'
import { formatRelativeDate } from '@/lib/utils'
import type { ImportPrefill } from '@/pages/checker'
import type { Source, SourcePreviewResponse, PreviewContext } from '@/lib/types'
import { toast } from 'sonner'

export default function SourcesPage() {
  const { data, isLoading } = useSources()
  const updateSource  = useUpdateSource()
  const deleteSource  = useDeleteSource()
  const syncSource    = useSyncSource()
  const verifySource  = useVerifySource()
  const [verifyingId, setVerifyingId] = useState<number | null>(null)
  const [verifyingAll, setVerifyingAll] = useState(false)
  const previewSource = usePreviewSource()
  const importUrl     = useImportUrl()
  const importText    = useImportText()
  const importXtream  = useImportXtream()

  // ── Dialog visibility ────────────────────────────────────────────────────
  type SourceTab = 'url' | 'paste' | 'xtream'
  const [dialogOpen,       setDialogOpen]       = useState(false)
  const [tab,              setTab]              = useState<SourceTab>('url')
  const [syncingId,        setSyncingId]        = useState<number | 'all' | null>(null)
  const [editSource,       setEditSource]       = useState<Source | null>(null)
  const [deleteTarget,     setDeleteTarget]     = useState<Source | null>(null)
  const [deleteChannels,   setDeleteChannels]   = useState(false)
  const [editExcluded,     setEditExcluded]     = useState<string[]>([])
  useEffect(() => { setEditExcluded(editSource?.excluded_groups ?? []) }, [editSource])

  // ── Preview state ────────────────────────────────────────────────────────
  const [previewOpen,    setPreviewOpen]    = useState(false)
  const [previewData,    setPreviewData]    = useState<SourcePreviewResponse | null>(null)
  const [previewContext, setPreviewContext] = useState<PreviewContext | null>(null)

  // ── URL form state ───────────────────────────────────────────────────────
  const [srcName,         setSrcName]         = useState('')
  const [srcUrl,          setSrcUrl]          = useState('')
  const [srcAutoSync,     setSrcAutoSync]     = useState(false)
  const [srcInterval,     setSrcInterval]     = useState('24')
  const [srcPriority,     setSrcPriority]     = useState('1')
  const [srcAutoPriority, setSrcAutoPriority] = useState(true)

  // ── Xtream form state ────────────────────────────────────────────────────
  const [xtName,     setXtName]     = useState('Xtream Import')
  const [xtHost,     setXtHost]     = useState('')
  const [xtUser,     setXtUser]     = useState('')
  const [xtPass,     setXtPass]     = useState('')
  const [xtShowPass, setXtShowPass] = useState(false)
  const [xtAutoSync, setXtAutoSync] = useState(false)
  const [xtInterval, setXtInterval] = useState('24')

  // ── Import text state ────────────────────────────────────────────────────
  const [importName,    setImportName]    = useState('Import Manual')
  const [importContent, setImportContent] = useState('')

  const sources = data?.sources ?? []

  // ── Verificación de salud por fuente ─────────────────────────────────────
  const qc = useQueryClient()
  const { data: healthStatus } = useHealthStatus()
  const { data: healthBreakdown } = useHealthBreakdown()
  const checkNow = useCheckNow()
  const cancelCheck = useCancelCheck()
  const isChecking = healthStatus?.isChecking ?? false
  const checkingSourceId = healthStatus?.checkingSourceId ?? null
  const progress = healthStatus?.progress

  const healthBySource = new Map((healthBreakdown?.bySource ?? []).map((r) => [r.id, r]))

  const handleCheckSource = async (src: Source) => {
    try {
      await checkNow.mutateAsync(src.id)
      qc.invalidateQueries({ queryKey: ['health', 'status'] })
      toast.success(`Verificando los canales de "${src.name}"…`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al iniciar la verificación')
    }
  }

  // Al terminar una verificación, se refrescan los datos y se avisa el resultado de esa fuente
  const wasChecking = useRef<{ checking: boolean; sourceId: number | null }>({ checking: false, sourceId: null })
  useEffect(() => {
    const prev = wasChecking.current
    if (prev.checking && !isChecking && prev.sourceId !== null) {
      qc.invalidateQueries({ queryKey: ['health'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Verificación de la fuente finalizada')
    }
    wasChecking.current = { checking: isChecking, sourceId: isChecking ? checkingSourceId : prev.sourceId }
  }, [isChecking, checkingSourceId, qc])

  // Viene del IPTV Checker ("Importar como fuente"): abre el diálogo ya completado
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const p = (location.state as { importPrefill?: ImportPrefill } | null)?.importPrefill
    if (!p) return
    setEditSource(null)
    if (p.type === 'xtream') {
      setXtName(p.name); setXtHost(p.host ?? ''); setXtUser(p.user ?? ''); setXtPass(p.pass ?? '')
      setXtAutoSync(false); setXtInterval('24')
      setTab('xtream')
    } else {
      setSrcName(p.name); setSrcUrl(p.url ?? '')
      setSrcAutoSync(false); setSrcInterval('24'); setSrcPriority('1'); setSrcAutoPriority(true)
      setTab('url')
    }
    setDialogOpen(true)
    navigate(location.pathname, { replace: true, state: null }) // evita reabrir al recargar
  }, [location, navigate])

  // ── Edit existing source — routes to correct dialog based on type ──────────
  const openEdit = (s: Source) => {
    setEditSource(s)
    if (s.type === 'xtream') {
      // Pre-fill Xtream dialog fields
      setXtName(s.name)
      setXtHost(s.xtream_host || '')
      setXtUser(s.xtream_user || '')
      setXtPass(s.xtream_pass || '')
      setXtAutoSync(!!s.auto_sync)
      setXtInterval(String(s.sync_interval_hours))
      setTab('xtream')
      setDialogOpen(true)
    } else {
      // Pre-fill URL / manual dialog fields
      setSrcName(s.name)
      setSrcUrl(s.url)
      setSrcAutoSync(!!s.auto_sync)
      setSrcInterval(String(s.sync_interval_hours))
      setSrcPriority(String(s.priority ?? 1))
      setSrcAutoPriority(s.auto_priority === 1)
      setTab('url')
      setDialogOpen(true)
    }
  }

  const openCreate = () => {
    setEditSource(null)
    setSrcName('')
    setSrcUrl('')
    setSrcAutoSync(false)
    setSrcInterval('24')
    setSrcPriority('1')
    setSrcAutoPriority(true)
    setImportName('Import Manual')
    setImportContent('')
    setXtName('Xtream Import')
    setXtHost(''); setXtUser(''); setXtPass('')
    setXtAutoSync(false)
    setXtInterval('24')
    setTab('url')
    setDialogOpen(true)
  }

  const handleSaveUrl = async () => {
    // EDIT mode: update URL/manual source metadata (no re-import)
    if (!editSource || !srcName.trim()) return
    try {
      await updateSource.mutateAsync({
        id: editSource.id,
        name: srcName.trim(),
        url: srcUrl.trim(),
        autoSync: srcAutoSync ? 1 : 0,
        syncIntervalHours: Number(srcInterval) || 24,
        priority: Number(srcPriority) || 1,
        autoPriority: srcAutoPriority ? 1 : 0,
        excludedGroups: editExcluded,
      })
      toast.success('Fuente actualizada')
      setDialogOpen(false)
      setEditSource(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const handleSaveXtream = async () => {
    // EDIT mode: update Xtream source metadata (no re-import)
    if (!editSource || !xtName.trim()) return
    try {
      await updateSource.mutateAsync({
        id: editSource.id,
        name: xtName.trim(),
        url: '',
        xtreamHost: xtHost.trim(),
        xtreamUser: xtUser.trim(),
        xtreamPass: xtPass.trim(),
        autoSync: xtAutoSync ? 1 : 0,
        syncIntervalHours: Number(xtInterval) || 24,
        priority: editSource.priority ?? 1,
        autoPriority: editSource.auto_priority ?? 1,
        excludedGroups: editExcluded,
      })
      toast.success('Fuente Xtream actualizada')
      setDialogOpen(false)
      setEditSource(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  // ── Preview handlers ──────────────────────────────────────────────────────

  const handlePreviewUrl = async () => {
    if (!srcName.trim() || !srcUrl.trim()) return
    try {
      const data = await previewSource.mutateAsync({ type: 'url', url: srcUrl.trim() })
      setPreviewData(data)
      setPreviewContext({
        type: 'url',
        name: srcName.trim(),
        url: srcUrl.trim(),
        autoSync: srcAutoSync ? 1 : 0,
        syncIntervalHours: Number(srcInterval) || 24,
        priority: Number(srcPriority) || 1,
        autoPriority: srcAutoPriority ? 1 : 0,
      })
      setDialogOpen(false)
      setPreviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al previsualizar: ' + (err as Error).message)
    }
  }

  const handlePreviewText = async () => {
    if (!importContent.trim()) return
    try {
      const data = await previewSource.mutateAsync({ type: 'text', text: importContent })
      setPreviewData(data)
      setPreviewContext({
        type: 'text',
        name: importName.trim() || 'Import Manual',
        text: importContent,
      })
      setDialogOpen(false)
      setPreviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al previsualizar')
    }
  }

  const handlePreviewXtream = async () => {
    if (!xtHost.trim() || !xtUser.trim() || !xtPass.trim()) return
    try {
      const data = await previewSource.mutateAsync({
        type: 'xtream',
        xtreamHost: xtHost.trim(),
        xtreamUser: xtUser.trim(),
        xtreamPass: xtPass.trim(),
      })
      setPreviewData(data)
      setPreviewContext({
        type: 'xtream',
        name: xtName.trim() || 'Xtream Import',
        xtreamHost: xtHost.trim(),
        xtreamUser: xtUser.trim(),
        xtreamPass: xtPass.trim(),
        autoSync: xtAutoSync ? 1 : 0,
        syncIntervalHours: Number(xtInterval) || 24,
        priority: 1,
        autoPriority: 1,
      })
      setDialogOpen(false)
      setPreviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al conectar con Xtream')
    }
  }

  // ── Confirm import (called from ImportPreviewDialog) ──────────────────────
  const handleImportConfirmed = async (selectedUrls: string[], excludedGroups: string[]) => {
    if (!previewContext) return
    try {
      let res
      if (previewContext.type === 'url') {
        res = await importUrl.mutateAsync({ ...previewContext, selectedUrls, excludedGroups })
      } else if (previewContext.type === 'text') {
        res = await importText.mutateAsync({
          text: previewContext.text,
          sourceName: previewContext.name,
          selectedUrls,
          excludedGroups,
        })
      } else {
        res = await importXtream.mutateAsync({ ...previewContext, selectedUrls, excludedGroups })
      }

      const parts = [
        res.imported > 0 ? `${res.imported.toLocaleString()} importados` : null,
        res.updated  > 0 ? `${res.updated.toLocaleString()} actualizados` : null,
        res.skipped  > 0 ? `${res.skipped.toLocaleString()} omitidos` : null,
      ].filter(Boolean).join(' · ')

      toast.success(parts || 'Importación completada')
      setPreviewOpen(false)
      setPreviewData(null)
      setPreviewContext(null)
      // Reset forms
      setImportContent('')
      setImportName('Import Manual')
      setXtHost(''); setXtUser(''); setXtPass('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al importar')
    }
  }

  const totalChannels = sources.reduce((n, x) => n + (x.channel_count ?? 0), 0)
  const isImporting = importUrl.isPending || importText.isPending || importXtream.isPending

  // ── Verify source connection (not channels) ──────────────────────────────
  const handleVerify = async (src: Source) => {
    setVerifyingId(src.id)
    try {
      const r = await verifySource.mutateAsync(src.id)
      if (!r.ok) {
        toast.error(`${src.name}: ${r.problem ?? 'la fuente no responde correctamente'}`)
        return
      }
      const parts: string[] = []
      if (r.type === 'xtream') {
        parts.push(r.status ? `estado ${r.status}` : 'cuenta activa')
        parts.push(r.expiresAt ? `vence ${new Date(r.expiresAt).toLocaleDateString('es-AR')}` : 'sin vencimiento')
        if (r.maxConnections) parts.push(`${r.activeConnections ?? 0} de ${r.maxConnections} conexiones en uso`)
        if (r.isTrial) parts.push('prueba')
      } else {
        parts.push('lista M3U accesible')
      }
      if (r.latencyMs != null) parts.push(`${r.latencyMs} ms`)
      toast.success(`${src.name}: ${parts.join(' · ')}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al verificar la fuente')
    } finally {
      setVerifyingId(null)
    }
  }

  const handleVerifyAll = async () => {
    const targets = sources.filter((x) => x.type === 'url' || x.type === 'xtream')
    if (targets.length === 0) return
    setVerifyingAll(true)
    let ok = 0
    const failed: string[] = []
    for (const src of targets) {
      setVerifyingId(src.id)
      try {
        const r = await verifySource.mutateAsync(src.id)
        if (r.ok) ok++
        else failed.push(`${src.name}: ${r.problem ?? 'no responde correctamente'}`)
      } catch (err) {
        failed.push(`${src.name}: ${err instanceof Error ? err.message : 'error al verificar'}`)
      }
    }
    setVerifyingId(null)
    setVerifyingAll(false)
    failed.forEach((m) => toast.error(m))
    if (ok > 0) toast.success(`${ok} de ${targets.length} ${targets.length === 1 ? 'fuente' : 'fuentes'} con conexión OK`)
  }

  // ── Sync ─────────────────────────────────────────────────────────────────
  const handleSync = async (id: number) => {
    setSyncingId(id)
    try {
      const res = await syncSource.mutateAsync(id)
      toast.success(`Sincronizado: ${res.imported} importados, ${res.updated} actualizados`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al sincronizar')
    } finally {
      setSyncingId(null)
    }
  }

  const handleSyncAll = async () => {
    const syncable = sources.filter((x) => x.type === 'url' || x.type === 'xtream')
    if (syncable.length === 0) return
    setSyncingId('all')
    let ok = 0
    for (const src of syncable) {
      try {
        await syncSource.mutateAsync(src.id)
        ok++
      } catch (err) {
        toast.error(`${src.name}: ${err instanceof Error ? err.message : 'Error al sincronizar'}`)
      }
    }
    setSyncingId(null)
    if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'fuente sincronizada' : 'fuentes sincronizadas'}`)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteSource.mutateAsync({ id: deleteTarget.id, deleteChannels })
      toast.success('Fuente eliminada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeleteTarget(null)
      setDeleteChannels(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const typeTag = (t: Source['type']) => (t === 'xtream' ? 'XTREAM' : t === 'manual' ? 'MANUAL' : 'URL')
  const sourceLine = (x: Source) =>
    x.type === 'xtream'
      ? `${x.xtream_host || '—'}${x.xtream_user ? ` · ${x.xtream_user}` : ''}`
      : x.type === 'manual' || !x.url
        ? `Contenido pegado · ${x.channel_count.toLocaleString('es-AR')} entradas`
        : x.url

  const isEditing = !!editSource
  const dialogTitle = isEditing ? (tab === 'xtream' ? 'Editar fuente Xtream' : 'Editar fuente') : 'Agregar fuente'
  const pending = previewSource.isPending

  let primary: React.ReactNode
  if (isEditing) {
    const isXt = tab === 'xtream'
    primary = (
      <Button
        onClick={isXt ? handleSaveXtream : handleSaveUrl}
        disabled={updateSource.isPending || (isXt ? !xtName.trim() || !xtHost.trim() || !xtUser.trim() : !srcName.trim())}
      >
        {updateSource.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Guardar
      </Button>
    )
  } else {
    const disabled =
      pending ||
      (tab === 'url' && (!srcName.trim() || !srcUrl.trim())) ||
      (tab === 'paste' && !importContent.trim()) ||
      (tab === 'xtream' && (!xtHost.trim() || !xtUser.trim() || !xtPass.trim()))
    const run = tab === 'url' ? handlePreviewUrl : tab === 'paste' ? handlePreviewText : handlePreviewXtream
    primary = (
      <Button onClick={run} disabled={disabled}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Eye aria-hidden="true" />}
        {pending ? (tab === 'xtream' ? 'Conectando...' : 'Cargando lista...') : 'Previsualizar'}
      </Button>
    )
  }

  const fieldLabel = 'text-[13px] font-normal text-muted-foreground'

  return (
    <>
      <PageHeader
        title="Fuentes M3U"
        subtitle="Listas importadas que se combinan en tu único link. Menor número = mayor prioridad."
        status={`${sources.length} ${sources.length === 1 ? 'FUENTE' : 'FUENTES'} · ${totalChannels.toLocaleString('es-AR')} CANALES COMBINADOS`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={handleSyncAll}
              disabled={syncingId !== null || !sources.some((x) => x.type === 'url' || x.type === 'xtream')}
            >
              {syncingId === 'all' && <Loader2 aria-hidden="true" className="animate-spin" />}
              Sincronizar todas
            </Button>
            <Button
              variant="secondary"
              onClick={handleVerifyAll}
              disabled={verifyingId !== null || verifyingAll || !sources.some((x) => x.type === 'url' || x.type === 'xtream')}
            >
              {verifyingAll ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
              Verificar todas
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Agregar fuente
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-[10px]" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={LinkIcon}
          title="No hay fuentes"
          description="Agregá una URL de lista M3U o pegá el contenido directamente."
          action={{ label: 'Agregar fuente', onClick: openCreate }}
        />
      ) : (
        <section aria-label="Fuentes" className="flex flex-col gap-3">
          {sources.map((source) => {
            const syncing = syncingId === source.id || syncingId === 'all'
            const canSync = source.type === 'url' || source.type === 'xtream'
            const autoOn = source.auto_sync === 1
            return (
              <article
                key={source.id}
                className="flex flex-wrap items-center gap-x-7 gap-y-4 rounded-[10px] border border-border bg-card px-5 py-[18px]"
              >
                <div className="flex min-w-0 flex-[2_1_340px] items-center gap-3.5">
                  <span className="min-w-[34px] font-mono text-[22px] text-primary">#{source.priority}</span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-[17px] font-bold">{source.name}</h2>
                      <span className="rounded border border-control px-[7px] py-[3px] font-mono text-[10px] tracking-[0.08em] text-[#C9CED4]">
                        {typeTag(source.type)}
                      </span>
                      <span className="font-mono text-[10px] tracking-[0.08em] text-label">
                        {source.auto_priority === 1 ? 'PRIORIDAD AUTO' : 'PRIORIDAD MANUAL'}
                      </span>
                    </div>
                    <span className="truncate font-mono text-xs text-[#7C838C]" title={sourceLine(source)}>
                      {sourceLine(source)}
                    </span>
                  </div>
                </div>
                <dl className="grid flex-[1_1_420px] grid-cols-4 gap-x-7 gap-y-1">
                  <dt className="text-[11px] tracking-[0.08em] text-label uppercase">Canales</dt>
                  <dt className="text-[11px] tracking-[0.08em] text-label uppercase">Salud</dt>
                  <dt className="text-[11px] tracking-[0.08em] text-label uppercase">Auto-sync</dt>
                  <dt className="text-[11px] tracking-[0.08em] text-label uppercase">Último sync</dt>
                  <dd className="font-mono text-[15px]">{source.channel_count.toLocaleString('es-AR')}</dd>
                  <dd className="flex items-center gap-2">
                    {(() => {
                      const h = healthBySource.get(source.id)
                      if (!h || h.total === 0) return <span className="font-mono text-[15px] text-label">—</span>
                      const pct = (n: number) => (n / h.total) * 100
                      return (
                        <>
                          <span aria-hidden="true" className="flex h-1.5 w-14 gap-px overflow-hidden rounded-[3px] bg-border">
                            <span style={{ width: `${pct(h.ok)}%`, background: STATUS_COLOR.healthy }} />
                            <span style={{ width: `${pct(h.deg)}%`, background: STATUS_COLOR.degraded }} />
                            <span style={{ width: `${pct(h.down)}%`, background: STATUS_COLOR.down }} />
                          </span>
                          <span className="font-mono text-[15px]" title={`${h.ok} online · ${h.deg} lentos/intermitentes · ${h.down} caídos`}>
                            {Math.round(pct(h.ok))}%
                          </span>
                        </>
                      )
                    })()}
                  </dd>
                  <dd className="font-mono text-[15px]" style={{ color: autoOn ? '#5AD1A0' : '#8A929B' }}>
                    {autoOn ? `cada ${source.sync_interval_hours} h` : 'apagado'}
                  </dd>
                  <dd className="font-mono text-[15px]" style={{ color: syncing ? '#F2A33A' : undefined }}>
                    {syncing ? 'sincronizando…' : source.last_synced_at ? formatRelativeDate(source.last_synced_at) : 'nunca'}
                  </dd>
                </dl>
                {source.verify_info && (() => {
                  const v = source.verify_info
                  const color = v.ok ? STATUS_COLOR.healthy : STATUS_COLOR.down
                  const exp = v.expiresAt ? new Date(v.expiresAt) : null
                  const daysLeft = exp ? Math.ceil((exp.getTime() - Date.now()) / 86_400_000) : null
                  const items: { label: string; value: string; title?: string }[] = []
                  if (v.type === 'xtream') {
                    if (v.status) items.push({ label: 'Estado', value: v.status })
                    items.push({
                      label: 'Vence',
                      value: exp ? `${exp.toLocaleDateString('es-AR')}${daysLeft !== null ? (daysLeft >= 0 ? ` (${daysLeft} d)` : ' (vencida)') : ''}` : 'sin vencimiento',
                    })
                    if (v.maxConnections) {
                      items.push({
                        label: 'Conexiones',
                        value: `${v.activeConnections ?? 0} de ${v.maxConnections} en uso`,
                        title: 'Streams que se están viendo ahora con esta cuenta, sobre el máximo simultáneo que permite',
                      })
                    }
                    if (v.isTrial) items.push({ label: 'Cuenta', value: 'de prueba' })
                  }
                  if (v.latencyMs != null) items.push({ label: 'Respuesta', value: `${v.latencyMs} ms` })
                  return (
                    <div className="flex basis-full flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border pt-3">
                      <span className="flex items-center gap-2 font-mono text-[13px]" style={{ color }}>
                        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color }} />
                        {v.ok ? 'Conexión OK' : v.problem ?? 'Con problemas'}
                      </span>
                      {items.map((it) => (
                        <span key={it.label} className="flex items-baseline gap-1.5" title={it.title}>
                          <span className="text-[11px] tracking-[0.08em] text-label uppercase">{it.label}</span>
                          <span className="font-mono text-[13px]">{it.value}</span>
                        </span>
                      ))}
                      <span className="ml-auto font-mono text-xs text-[#7C838C]">
                        verificada {formatRelativeDate(v.checkedAt)}
                      </span>
                    </div>
                  )
                })()}
                <div className="flex basis-full flex-wrap justify-end gap-2 border-t border-border pt-4">
                  {source.channel_count > 0 && (
                    isChecking && checkingSourceId === source.id ? (
                      <Button variant="secondary" onClick={() => cancelCheck.mutate()} disabled={cancelCheck.isPending}>
                        <Loader2 aria-hidden="true" className="animate-spin" />
                        Detener{progress && progress.total > 0 ? ` · ${progress.checked}/${progress.total}` : ''}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => handleCheckSource(source)}
                        disabled={isChecking || checkNow.isPending}
                        title={isChecking ? 'Ya hay una verificación en curso' : undefined}
                      >
                        <Activity aria-hidden="true" />
                        Verificar canales
                      </Button>
                    )
                  )}
                  {source.type !== 'manual' && (
                    <Button variant="secondary" onClick={() => handleVerify(source)} disabled={verifyingId !== null || verifyingAll}>
                      {verifyingId === source.id ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
                      Verificar fuente
                    </Button>
                  )}
                  {canSync && (
                    <Button variant="secondary" onClick={() => handleSync(source.id)} disabled={syncingId !== null}>
                      {syncing ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
                      Sincronizar
                    </Button>
                  )}
                  <Button variant="secondary" size="icon" aria-label={`Editar ${source.name}`} onClick={() => openEdit(source)}>
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button variant="destructive" size="icon" aria-label={`Eliminar ${source.name}`} onClick={() => setDeleteTarget(source)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      <section
        aria-label="Cómo se combinan"
        className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] border border-dashed border-control px-5 py-4 text-[13px] text-muted-foreground"
      >
        <span className="font-mono text-primary">MERGE</span>
        <span className="flex-[1_1_400px] leading-normal">
          Si un canal existe en varias fuentes, se usa el de mayor prioridad y los demás quedan como alternativas. Con
          prioridad automática, gana el stream con mejor latencia.
        </span>
      </section>

      {/* ── Add / edit dialog ───────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditSource(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-xl">{dialogTitle}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? tab === 'xtream'
                  ? 'Editá las credenciales y configuración de esta fuente Xtream.'
                  : 'Editá los datos de esta fuente. No se vuelve a importar.'
                : 'Al previsualizar se descarga la lista para que elijas qué canales importar.'}
            </DialogDescription>
          </DialogHeader>

          {!isEditing && (
            <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)}>
              <TabsList aria-label="Tipo de fuente" className="w-full">
                <TabsTrigger value="url">URL</TabsTrigger>
                <TabsTrigger value="paste">Pegar M3U</TabsTrigger>
                <TabsTrigger value="xtream">Xtream</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {tab === 'url' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="src-name" className={fieldLabel}>Nombre</Label>
                <Input id="src-name" value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="Mi lista" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="src-url" className={fieldLabel}>URL de la lista</Label>
                <Input id="src-url" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://…/lista.m3u" className="font-mono text-[13px]" />
              </div>
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] text-[#C9CED4]">
                  <Checkbox checked={srcAutoSync} onCheckedChange={(c) => setSrcAutoSync(c === true)} />
                  Auto-sync
                </label>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="src-interval" className={fieldLabel}>Intervalo (horas)</Label>
                  <Input id="src-interval" type="number" min="1" value={srcInterval} disabled={!srcAutoSync} onChange={(e) => setSrcInterval(e.target.value)} className="font-mono text-[13px]" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="src-priority" className={fieldLabel}>Prioridad</Label>
                  <Input id="src-priority" type="number" min="1" value={srcPriority} disabled={srcAutoPriority} onChange={(e) => setSrcPriority(e.target.value)} className="font-mono text-[13px]" />
                </div>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] text-[#C9CED4]">
                <Checkbox checked={srcAutoPriority} onCheckedChange={(c) => setSrcAutoPriority(c === true)} />
                Prioridad automática (gana el stream con mejor latencia)
              </label>
            </div>
          )}

          {tab === 'paste' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-name" className={fieldLabel}>Nombre de la fuente</Label>
                <Input id="import-name" value={importName} onChange={(e) => setImportName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-content" className={fieldLabel}>Contenido M3U</Label>
                <Textarea
                  id="import-content"
                  value={importContent}
                  onChange={(e) => setImportContent(e.target.value)}
                  className="min-h-48 font-mono text-xs"
                  placeholder={`#EXTM3U\n#EXTINF:-1 tvg-id="..." tvg-name="..." group-title="...",Canal 1\nhttp://...`}
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          {tab === 'xtream' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="xt-name" className={fieldLabel}>Nombre de la fuente</Label>
                <Input id="xt-name" value={xtName} onChange={(e) => setXtName(e.target.value)} placeholder="Mi Xtream" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="xt-host" className={fieldLabel}>URL del servidor</Label>
                <Input id="xt-host" value={xtHost} onChange={(e) => setXtHost(e.target.value)} placeholder="http://servidor.com:8080" className="font-mono text-[13px]" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xt-user" className={fieldLabel}>Usuario</Label>
                  <Input id="xt-user" value={xtUser} onChange={(e) => setXtUser(e.target.value)} placeholder="usuario123" autoComplete="username" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xt-pass" className={fieldLabel}>Contraseña</Label>
                  <div className="relative">
                    <Input
                      id="xt-pass"
                      type={xtShowPass ? 'text' : 'password'}
                      value={xtPass}
                      onChange={(e) => setXtPass(e.target.value)}
                      placeholder={editSource ? '(sin cambios)' : '••••••••'}
                      autoComplete="current-password"
                      className="pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setXtShowPass((v) => !v)}
                      className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-label transition-colors hover:text-foreground"
                      aria-label={xtShowPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {xtShowPass ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] text-[#C9CED4]">
                  <Checkbox checked={xtAutoSync} onCheckedChange={(c) => setXtAutoSync(c === true)} />
                  Auto-sync
                </label>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xt-interval" className={fieldLabel}>Intervalo (horas)</Label>
                  <Input id="xt-interval" type="number" min="1" value={xtInterval} disabled={!xtAutoSync} onChange={(e) => setXtInterval(e.target.value)} className="font-mono text-[13px]" />
                </div>
              </div>
            </div>
          )}

          {isEditing && <ExcludedGroupsEditor groups={editExcluded} onChange={setEditExcluded} />}

          <DialogFooter>
            <Button variant="secondary" onClick={() => { setDialogOpen(false); setEditSource(null) }}>Cancelar</Button>
            {primary}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Preview Dialog ────────────────────────────────────────────── */}
      {previewData && previewContext && (
        <ImportPreviewDialog
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open)
            if (!open) { setPreviewData(null); setPreviewContext(null) }
          }}
          sourceName={previewContext.name}
          preview={previewData}
          isSubmitting={isImporting}
          onConfirm={handleImportConfirmed}
        />
      )}

      {/* ── Delete dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteChannels(false) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Eliminar fuente</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar la fuente "{deleteTarget?.name}"?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <Switch id="delete-channels-toggle" checked={deleteChannels} onCheckedChange={setDeleteChannels} />
              <div className="space-y-0.5">
                <Label htmlFor="delete-channels-toggle" className="text-sm font-medium">
                  Eliminar canales importados
                </Label>
                <p className="text-xs text-muted-foreground">Borra todos los canales asociados a esta lista</p>
              </div>
            </div>
            {!deleteChannels && (
              <p className="px-1 text-xs text-muted-foreground">
                Nota: si no los eliminás, los canales se conservarán como canales manuales.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteChannels(false) }}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteSource.isPending}>
              {deleteSource.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
