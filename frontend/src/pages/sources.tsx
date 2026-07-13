import { useState } from 'react'
import { Link as LinkIcon, Plus, RefreshCw, Pencil, Trash2, FileText, Loader2, Clock, Server, Eye, EyeOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useSources, useUpdateSource, useDeleteSource, useSyncSource,
  usePreviewSource, useImportUrl, useImportText, useImportXtream,
} from '@/hooks/use-sources'
import { ImportPreviewDialog } from '@/components/sources/ImportPreviewDialog'
import { formatRelativeDate } from '@/lib/utils'
import type { Source, SourcePreviewResponse, PreviewContext } from '@/lib/types'
import { toast } from 'sonner'

export default function SourcesPage() {
  const { data, isLoading } = useSources()
  const updateSource  = useUpdateSource()
  const deleteSource  = useDeleteSource()
  const syncSource    = useSyncSource()
  const previewSource = usePreviewSource()
  const importUrl     = useImportUrl()
  const importText    = useImportText()
  const importXtream  = useImportXtream()

  // ── Dialog visibility ────────────────────────────────────────────────────
  const [urlDialogOpen,    setUrlDialogOpen]    = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [xtreamDialogOpen, setXtreamDialogOpen] = useState(false)
  const [editSource,       setEditSource]       = useState<Source | null>(null)
  const [deleteTarget,     setDeleteTarget]     = useState<Source | null>(null)
  const [deleteChannels,   setDeleteChannels]   = useState(false)

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
      setXtreamDialogOpen(true)
    } else {
      // Pre-fill URL / manual dialog fields
      setSrcName(s.name)
      setSrcUrl(s.url)
      setSrcAutoSync(!!s.auto_sync)
      setSrcInterval(String(s.sync_interval_hours))
      setSrcPriority(String(s.priority ?? 1))
      setSrcAutoPriority(s.auto_priority === 1)
      setUrlDialogOpen(true)
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
    setUrlDialogOpen(true)
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
      })
      toast.success('Fuente actualizada')
      setUrlDialogOpen(false)
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
      })
      toast.success('Fuente Xtream actualizada')
      setXtreamDialogOpen(false)
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
      setUrlDialogOpen(false)
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
      setImportDialogOpen(false)
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
      setXtreamDialogOpen(false)
      setPreviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al conectar con Xtream')
    }
  }

  // ── Confirm import (called from ImportPreviewDialog) ──────────────────────
  const handleImportConfirmed = async (selectedUrls: string[]) => {
    if (!previewContext) return
    try {
      let res
      if (previewContext.type === 'url') {
        res = await importUrl.mutateAsync({ ...previewContext, selectedUrls })
      } else if (previewContext.type === 'text') {
        res = await importText.mutateAsync({
          text: previewContext.text,
          sourceName: previewContext.name,
          selectedUrls,
        })
      } else {
        res = await importXtream.mutateAsync({ ...previewContext, selectedUrls })
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

  const isImporting = importUrl.isPending || importText.isPending || importXtream.isPending

  // ── Sync ─────────────────────────────────────────────────────────────────
  const handleSync = async (id: number) => {
    try {
      const res = await syncSource.mutateAsync(id)
      toast.success(`Sincronizado: ${res.imported} importados, ${res.updated} actualizados`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al sincronizar')
    }
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
  return (
    <div>
      <PageHeader
        title="Fuentes M3U"
        subtitle="Listas importadas que se combinan en tu único link"
        icon={LinkIcon}
        actions={
          <>
            <Button variant="outline" onClick={() => { setImportName('Import Manual'); setImportContent(''); setImportDialogOpen(true) }}>
              <FileText className="w-4 h-4 mr-2" />
              Pegar M3U
            </Button>
            <Button variant="outline" onClick={() => { setXtName('Xtream Import'); setXtHost(''); setXtUser(''); setXtPass(''); setXtAutoSync(false); setXtInterval('24'); setXtreamDialogOpen(true) }}>
              <Server className="w-4 h-4 mr-2" />
              Xtream
            </Button>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Agregar URL
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={LinkIcon}
          title="No hay fuentes"
          description="Agregá una URL de lista M3U o pegá el contenido directamente."
          action={{ label: 'Agregar URL', onClick: openCreate }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((source) => (
            <Card key={source.id} className="hover:border-border/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold leading-tight">{source.name}</CardTitle>
                  <Badge variant="outline" className="text-xs flex-shrink-0 capitalize">{source.type}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {source.type === 'xtream' ? (
                  <div className="space-y-0.5">
                    <p className="text-xs font-mono text-muted-foreground truncate" title={source.xtream_host}>
                      {source.xtream_host || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground/60 truncate">
                      Usuario: <span className="font-mono">{source.xtream_user || '—'}</span>
                    </p>
                  </div>
                ) : source.url ? (
                  <p className="text-xs font-mono text-muted-foreground truncate" title={source.url}>
                    {source.url}
                  </p>
                ) : null}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {source.last_synced_at ? formatRelativeDate(source.last_synced_at) : 'Nunca sincronizado'}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {source.channel_count.toLocaleString()} canales
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-xs">
                    Prioridad: {source.priority} {source.auto_priority === 1 ? '(Auto)' : '(Manual)'}
                  </Badge>
                  {source.auto_sync === 1 && (
                    <span className="text-muted-foreground">
                      Auto-sync cada {source.sync_interval_hours}h
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {(source.type === 'url' || source.type === 'xtream') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs"
                      onClick={() => handleSync(source.id)}
                      disabled={syncSource.isPending}
                    >
                      {syncSource.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1.5" />
                      )}
                      Sincronizar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(source)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(source)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── URL form dialog (CREATE → preview / EDIT → save directly) ──── */}
      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSource ? 'Editar fuente' : 'Agregar fuente M3U'}</DialogTitle>
            {!editSource && (
              <DialogDescription>
                Al hacer clic en "Previsualizar" se descargará la lista para que elijas qué canales importar.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="src-name">Nombre *</Label>
              <Input id="src-name" value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="Mi lista" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="src-url">URL del M3U {!editSource && '*'}</Label>
              <Input id="src-url" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://..." className="font-mono text-sm" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="src-autosync">Auto-sync</Label>
              <Switch id="src-autosync" checked={srcAutoSync} onCheckedChange={setSrcAutoSync} />
            </div>
            {srcAutoSync && (
              <div className="space-y-1.5">
                <Label htmlFor="src-interval">Intervalo (horas)</Label>
                <Input id="src-interval" type="number" min="1" value={srcInterval} onChange={(e) => setSrcInterval(e.target.value)} />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="src-autopriority">Prioridad automática</Label>
              <Switch id="src-autopriority" checked={srcAutoPriority} onCheckedChange={setSrcAutoPriority} />
            </div>
            {!srcAutoPriority && (
              <div className="space-y-1.5">
                <Label htmlFor="src-priority">Prioridad (1 = Mayor prioridad)</Label>
                <Input id="src-priority" type="number" min="1" value={srcPriority} onChange={(e) => setSrcPriority(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlDialogOpen(false)}>Cancelar</Button>
            {editSource ? (
              <Button onClick={handleSaveUrl} disabled={!srcName.trim() || updateSource.isPending}>
                {updateSource.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            ) : (
              <Button
                onClick={handlePreviewUrl}
                disabled={!srcName.trim() || !srcUrl.trim() || previewSource.isPending}
              >
                {previewSource.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cargando lista...</>
                  : <><Eye className="w-4 h-4 mr-2" />Previsualizar</>
                }
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import text dialog ─────────────────────────────────────────────── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pegar contenido M3U</DialogTitle>
            <DialogDescription>
              Pegá el contenido de tu archivo .m3u. Podrás elegir qué canales importar en el siguiente paso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="import-name">Nombre de la fuente</Label>
              <Input id="import-name" value={importName} onChange={(e) => setImportName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-content">Contenido M3U</Label>
              <Textarea
                id="import-content"
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                className="font-mono text-xs min-h-64"
                placeholder={`#EXTM3U\n#EXTINF:-1 tvg-id="..." tvg-name="..." group-title="...",Canal 1\nhttp://...`}
                spellCheck={false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handlePreviewText} disabled={!importContent.trim() || previewSource.isPending}>
              {previewSource.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Procesando...</>
                : <><Eye className="w-4 h-4 mr-2" />Previsualizar</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Xtream import/edit dialog ────────────────────────────────────────── */}
      <Dialog open={xtreamDialogOpen} onOpenChange={(open) => { setXtreamDialogOpen(open); if (!open) setEditSource(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSource ? 'Editar fuente Xtream' : 'Agregar fuente Xtream Codes'}</DialogTitle>
            <DialogDescription>
              {editSource
                ? 'Editá las credenciales y configuración de esta fuente Xtream.'
                : 'Ingresá las credenciales. Se conectará al panel para previsualizar los canales antes de importar.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="xt-name">Nombre de la fuente</Label>
              <Input id="xt-name" value={xtName} onChange={(e) => setXtName(e.target.value)} placeholder="Mi Xtream" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xt-host">URL del servidor *</Label>
              <Input id="xt-host" value={xtHost} onChange={(e) => setXtHost(e.target.value)} placeholder="http://servidor.com:8080" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xt-user">Usuario *</Label>
              <Input id="xt-user" value={xtUser} onChange={(e) => setXtUser(e.target.value)} placeholder="usuario123" autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xt-pass">Contraseña {!editSource && '*'}</Label>
              <div className="relative">
                <Input
                  id="xt-pass"
                  type={xtShowPass ? 'text' : 'password'}
                  value={xtPass}
                  onChange={(e) => setXtPass(e.target.value)}
                  placeholder={editSource ? '(sin cambios)' : '••••••••'}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setXtShowPass(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  title={xtShowPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {xtShowPass
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="xt-autosync">Auto-sync</Label>
              <Switch id="xt-autosync" checked={xtAutoSync} onCheckedChange={setXtAutoSync} />
            </div>
            {xtAutoSync && (
              <div className="space-y-1.5">
                <Label htmlFor="xt-interval">Intervalo (horas)</Label>
                <Input id="xt-interval" type="number" min="1" value={xtInterval} onChange={(e) => setXtInterval(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setXtreamDialogOpen(false); setEditSource(null) }}>Cancelar</Button>
            {editSource ? (
              <Button
                onClick={handleSaveXtream}
                disabled={!xtName.trim() || !xtHost.trim() || !xtUser.trim() || updateSource.isPending}
              >
                {updateSource.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            ) : (
              <Button
                onClick={handlePreviewXtream}
                disabled={!xtHost.trim() || !xtUser.trim() || !xtPass.trim() || previewSource.isPending}
              >
                {previewSource.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Conectando...</>
                  : <><Eye className="w-4 h-4 mr-2" />Previsualizar</>
                }
              </Button>
            )}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar fuente</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar la fuente "{deleteTarget?.name}"?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center space-x-3 bg-muted/50 p-3 rounded-lg border border-border">
              <Switch id="delete-channels-toggle" checked={deleteChannels} onCheckedChange={setDeleteChannels} />
              <div className="space-y-0.5">
                <Label htmlFor="delete-channels-toggle" className="text-sm font-medium cursor-pointer">
                  Eliminar canales importados
                </Label>
                <p className="text-xs text-muted-foreground">Borra todos los canales asociados a esta lista</p>
              </div>
            </div>
            {!deleteChannels && (
              <p className="text-xs text-muted-foreground mt-2 px-1">
                Nota: Si no los eliminas, los canales se conservarán como canales manuales.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteChannels(false) }}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteSource.isPending}>
              {deleteSource.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
