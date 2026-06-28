import { useState, useEffect } from 'react'
import {
  Settings, Link, Calendar, ListMusic, Activity, Copy,
  Loader2, ClipboardCopy, RefreshCw,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSettings, useUpdateSettings, useRegenerateToken } from '@/hooks/use-settings'
import { toast } from 'sonner'

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const regenerateToken = useRegenerateToken()

  const [epgUrls, setEpgUrls] = useState('')
  const [playlistName, setPlaylistName] = useState('')
  const [healthEnabled, setHealthEnabled] = useState(true)
  const [dupThreshold, setDupThreshold] = useState(80)
  const [regenOpen, setRegenOpen] = useState(false)

  useEffect(() => {
    if (!settings) return
    setEpgUrls(settings.epg_urls ?? '')
    setPlaylistName(settings.playlist_name ?? '')
    setHealthEnabled(settings.health_check_enabled === '1')
    setDupThreshold(Number(settings.duplicate_threshold) || 80)
  }, [settings])

  const playlistUrl = settings
    ? `${window.location.origin}/playlist/${settings.playlist_token}/playlist.m3u`
    : ''

  const handleCopyLink = () => {
    navigator.clipboard.writeText(playlistUrl).then(
      () => toast.success('Link copiado'),
      () => toast.error('No se pudo copiar')
    )
  }

  const handleRegenerate = async () => {
    try {
      await regenerateToken.mutateAsync()
      toast.success('Token regenerado. Actualizá el link en TiviMate.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al regenerar')
    } finally {
      setRegenOpen(false)
    }
  }

  const save = async (data: Record<string, string>) => {
    try {
      await updateSettings.mutateAsync(data)
      toast.success('Guardado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Configuración" icon={Settings} />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Configuración" icon={Settings} />

      <div className="space-y-4 max-w-2xl">
        {/* 1. M3U Link */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Link className="w-4 h-4 text-primary" />
              Tu Link M3U Único
            </CardTitle>
            <CardDescription className="text-xs">
              Link estable para TiviMate. Se actualiza automáticamente al modificar tu lista.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/60 border border-border/60">
              <code className="flex-1 text-xs font-mono text-primary break-all">{playlistUrl}</code>
              <Button size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0" onClick={handleCopyLink}>
                <ClipboardCopy className="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setRegenOpen(true)}
              disabled={regenerateToken.isPending}
            >
              {regenerateToken.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Regenerar token
            </Button>
          </CardContent>
        </Card>

        {/* 2. EPG */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Guía de Programación (EPG)
            </CardTitle>
            <CardDescription className="text-xs">
              URLs XMLTV incluidas en el header del M3U como x-tvg-url.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={epgUrls}
              onChange={(e) => setEpgUrls(e.target.value)}
              className="font-mono text-xs min-h-24"
              placeholder="https://epg.provider.com/epg.xml&#10;https://otra-guia.com/guide.xml"
            />
            <Button size="sm" onClick={() => save({ epg_urls: epgUrls })}>
              Guardar EPG
            </Button>
          </CardContent>
        </Card>

        {/* 3. Playlist name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-primary" />
              Nombre de Playlist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="playlist-name">Nombre</Label>
              <Input
                id="playlist-name"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="My IPTV Playlist"
              />
            </div>
            <Button size="sm" onClick={() => save({ playlist_name: playlistName })}>
              Guardar nombre
            </Button>
          </CardContent>
        </Card>

        {/* 4. Health checker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Health Checker
            </CardTitle>
            <CardDescription className="text-xs">
              Verificación automática de streams cada 15 minutos. Timeout: 5s.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="health-enabled">Habilitar verificación automática</Label>
              <Switch
                id="health-enabled"
                checked={healthEnabled}
                onCheckedChange={setHealthEnabled}
              />
            </div>
            <Button size="sm" onClick={() => save({ health_check_enabled: healthEnabled ? '1' : '0' })}>
              Guardar
            </Button>
          </CardContent>
        </Card>

        {/* 5. Duplicate threshold */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Copy className="w-4 h-4 text-primary" />
              Detección de Duplicados
            </CardTitle>
            <CardDescription className="text-xs">
              Umbral mínimo de similitud de nombres para sugerir agrupación como alternativas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>
                Umbral: <span className="text-primary font-bold">{dupThreshold}%</span>
              </Label>
              <Slider
                min={60}
                max={100}
                step={1}
                value={[dupThreshold]}
                onValueChange={([v]) => setDupThreshold(v)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>60% (más resultados)</span>
                <span>100% (exactos)</span>
              </div>
            </div>
            <Button size="sm" onClick={() => save({ duplicate_threshold: String(dupThreshold) })}>
              Guardar
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="Regenerar token del playlist"
        description="El link actual dejará de funcionar. Deberás actualizar la URL en TiviMate u otras apps."
        confirmLabel="Regenerar"
        onConfirm={handleRegenerate}
      />
    </div>
  )
}
