import { useState } from 'react'
import { Link as LinkIcon, Plus, RefreshCw, Pencil, Trash2, FileText, Loader2, Clock } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
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
import { useSources, useCreateSource, useUpdateSource, useDeleteSource, useSyncSource, useImportText } from '@/hooks/use-sources'
import { formatRelativeDate } from '@/lib/utils'
import type { Source } from '@/lib/types'
import { toast } from 'sonner'

export default function SourcesPage() {
  const { data, isLoading } = useSources()
  const createSource = useCreateSource()
  const updateSource = useUpdateSource()
  const deleteSource = useDeleteSource()
  const syncSource = useSyncSource()
  const importText = useImportText()

  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [editSource, setEditSource] = useState<Source | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null)
  const [deleteChannels, setDeleteChannels] = useState(false)

  // URL form state
  const [srcName, setSrcName] = useState('')
  const [srcUrl, setSrcUrl] = useState('')
  const [srcAutoSync, setSrcAutoSync] = useState(false)
  const [srcInterval, setSrcInterval] = useState('24')
  const [srcPriority, setSrcPriority] = useState('1')
  const [srcAutoPriority, setSrcAutoPriority] = useState(true)

  // Import text state
  const [importName, setImportName] = useState('Import Manual')
  const [importContent, setImportContent] = useState('')

  const sources = data?.sources ?? []

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

  const openEdit = (s: Source) => {
    setEditSource(s)
    setSrcName(s.name)
    setSrcUrl(s.url)
    setSrcAutoSync(!!s.auto_sync)
    setSrcInterval(String(s.sync_interval_hours))
    setSrcPriority(String(s.priority ?? 1))
    setSrcAutoPriority(s.auto_priority === 1)
    setUrlDialogOpen(true)
  }

  const handleSaveUrl = async () => {
    if (!srcName.trim()) return
    const payload = {
      name: srcName.trim(),
      url: srcUrl.trim() || undefined,
      type: srcUrl.trim() ? 'url' : 'manual',
      autoSync: srcAutoSync ? 1 : 0,
      syncIntervalHours: Number(srcInterval) || 24,
      priority: Number(srcPriority) || 1,
      autoPriority: srcAutoPriority ? 1 : 0,
    }
    try {
      if (editSource) {
        await updateSource.mutateAsync({ id: editSource.id, ...payload })
        toast.success('Fuente actualizada')
      } else {
        await createSource.mutateAsync(payload)
        toast.success('Fuente creada')
      }
      setUrlDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const handleSync = async (id: number) => {
    try {
      const res = await syncSource.mutateAsync(id)
      toast.success(`Sincronizado: ${res.imported} importados, ${res.updated} actualizados`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al sincronizar')
    }
  }

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

  const handleImport = async () => {
    if (!importContent.trim()) return
    try {
      const res = await importText.mutateAsync({ text: importContent, sourceName: importName || undefined })
      toast.success(`Importado: ${res.imported} nuevos, ${res.updated} actualizados`)
      setImportDialogOpen(false)
      setImportContent('')
      setImportName('Import Manual')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al importar')
    }
  }

  return (
    <div>
      <PageHeader
        title="Fuentes M3U"
        subtitle="Listas importadas que se combinan en tu único link"
        icon={LinkIcon}
        actions={
          <>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <FileText className="w-4 h-4 mr-2" />
              Pegar M3U
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
                  <Badge variant="outline" className="text-xs flex-shrink-0 capitalize">
                    {source.type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {source.url && (
                  <p className="text-xs font-mono text-muted-foreground truncate" title={source.url}>
                    {source.url}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {source.last_synced_at ? formatRelativeDate(source.last_synced_at) : 'Nunca sincronizado'}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {source.channel_count} canales
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
                  {source.type === 'url' && (
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

      {/* URL form dialog */}
      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSource ? 'Editar fuente' : 'Agregar fuente M3U'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="src-name">Nombre *</Label>
              <Input id="src-name" value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="Mi lista" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="src-url">URL del M3U</Label>
              <Input id="src-url" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://..." className="font-mono text-sm" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="src-autosync">Auto-sync</Label>
              <Switch id="src-autosync" checked={srcAutoSync} onCheckedChange={setSrcAutoSync} />
            </div>
            {srcAutoSync && (
              <div className="space-y-1.5">
                <Label htmlFor="src-interval">Intervalo (horas)</Label>
                <Input
                  id="src-interval"
                  type="number"
                  min="1"
                  value={srcInterval}
                  onChange={(e) => setSrcInterval(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="src-autopriority">Prioridad automática</Label>
              <Switch id="src-autopriority" checked={srcAutoPriority} onCheckedChange={setSrcAutoPriority} />
            </div>
            {!srcAutoPriority && (
              <div className="space-y-1.5">
                <Label htmlFor="src-priority">Prioridad (1 = Mayor prioridad)</Label>
                <Input
                  id="src-priority"
                  type="number"
                  min="1"
                  value={srcPriority}
                  onChange={(e) => setSrcPriority(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveUrl} disabled={!srcName.trim() || createSource.isPending || updateSource.isPending}>
              {(createSource.isPending || updateSource.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editSource ? 'Guardar' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import text dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pegar contenido M3U</DialogTitle>
            <DialogDescription>Pegá el contenido de tu archivo .m3u directamente</DialogDescription>
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
            <Button onClick={handleImport} disabled={!importContent.trim() || importText.isPending}>
              {importText.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteChannels(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar fuente</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar la fuente "{deleteTarget?.name}"?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center space-x-3 bg-muted/50 p-3 rounded-lg border border-border">
              <Switch
                id="delete-channels-toggle"
                checked={deleteChannels}
                onCheckedChange={setDeleteChannels}
              />
              <div className="space-y-0.5">
                <Label htmlFor="delete-channels-toggle" className="text-sm font-medium cursor-pointer">
                  Eliminar canales importados
                </Label>
                <p className="text-xs text-muted-foreground">
                  Borra todos los canales asociados a esta lista
                </p>
              </div>
            </div>
            {!deleteChannels && (
              <p className="text-xs text-muted-foreground mt-2 px-1">
                Nota: Si no los eliminas, los canales se conservarán como canales manuales.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteChannels(false); }}>
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
