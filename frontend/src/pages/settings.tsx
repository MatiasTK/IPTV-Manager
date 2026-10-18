import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useSettings, useUpdateSettings, useRegenerateToken } from '@/hooks/use-settings'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function intervalLabel(min: number) {
  if (min < 60) return `Cada ${min} minutos`
  if (min === 60) return 'Cada hora'
  return min % 60 === 0 ? `Cada ${min / 60} horas` : `Cada ${min} minutos`
}

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const regenerateToken = useRegenerateToken()

  const [epgUrls, setEpgUrls] = useState('')
  const [playlistName, setPlaylistName] = useState('')
  const [healthEnabled, setHealthEnabled] = useState(true)
  const [dupThreshold, setDupThreshold] = useState(80)
  const [interval, setIntervalMin] = useState('15')
  const [regenOpen, setRegenOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!settings) return
    setEpgUrls(settings.epg_urls ?? '')
    setPlaylistName(settings.playlist_name ?? '')
    setHealthEnabled(settings.health_check_enabled === '1')
    setDupThreshold(Number(settings.duplicate_threshold) || 80)
    setIntervalMin(settings.health_check_interval_minutes || '15')
  }, [settings])

  const playlistUrl = settings
    ? `${window.location.origin}/playlist/${settings.playlist_token}/playlist.m3u`
    : ''

  const handleCopyLink = () => {
    navigator.clipboard.writeText(playlistUrl).then(
      () => {
        toast.success('Link copiado')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => toast.error('No se pudo copiar')
    )
  }

  const handleRegenerate = async () => {
    try {
      await regenerateToken.mutateAsync()
      toast.success('Token regenerado. Actualizá el link en TiviMate.')
      setCopied(false)
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
      setSaved(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const section = 'flex flex-col gap-3 rounded-[10px] border border-border bg-card p-5'
  const sectionTitle = 'text-base font-bold'
  const fieldLabel = 'text-[13px] font-normal text-muted-foreground'
  const hint = 'text-xs text-label'
  const saveButton = 'self-start'
  const pending = updateSettings.isPending

  const header = (
    <PageHeader
      title="Configuración"
      status={saved ? 'CAMBIOS GUARDADOS' : 'SISTEMA'}
      statusColor={saved ? '#5AD1A0' : '#F2A33A'}
    />
  )

  if (isLoading) {
    return (
      <>
        {header}
        <Skeleton className="h-36 rounded-[10px]" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-[10px]" />
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      {header}

      <section aria-label="Link de la playlist" className={cn(section, 'gap-3.5')}>
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-bold">Link de la playlist</h2>
          <span className="text-[13px] text-muted-foreground">
            Link estable para TiviMate. Se actualiza solo cada vez que modificás tu lista.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <code className="min-w-0 flex-[1_1_360px] rounded-lg border border-control bg-background px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere] text-primary">
            {playlistUrl}
          </code>
          <Button variant="secondary" onClick={handleCopyLink}>{copied ? 'Copiado' : 'Copiar'}</Button>
          <Button variant="destructive" onClick={() => setRegenOpen(true)} disabled={regenerateToken.isPending}>
            {regenerateToken.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
            Regenerar token
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4">
        <section aria-label="Guía EPG" className={section}>
          <h2 className={sectionTitle}>Guía EPG</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="epg-urls" className={fieldLabel}>URLs de guía XMLTV (una por línea)</Label>
            <Textarea
              id="epg-urls"
              value={epgUrls}
              onChange={(e) => setEpgUrls(e.target.value)}
              rows={4}
              className="font-mono text-xs leading-relaxed"
              placeholder={'https://epg.provider.com/epg.xml\nhttps://otra-guia.com/guide.xml'}
              spellCheck={false}
            />
            <span className={hint}>Se incluyen en el header del M3U como x-tvg-url.</span>
          </div>
          <Button className={saveButton} disabled={pending} onClick={() => save({ epg_urls: epgUrls })}>
            Guardar EPG
          </Button>
        </section>

        <section aria-label="Nombre de playlist" className={section}>
          <h2 className={sectionTitle}>Nombre de la playlist</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="playlist-name" className={fieldLabel}>Nombre</Label>
            <Input
              id="playlist-name"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="Mi IPTV"
            />
            <span className={hint}>Es el nombre que verás en TiviMate al agregar la lista.</span>
          </div>
          <Button className={saveButton} disabled={pending} onClick={() => save({ playlist_name: playlistName })}>
            Guardar nombre
          </Button>
        </section>

        <section aria-label="Health checker" className={section}>
          <h2 className={sectionTitle}>Health checker</h2>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="health-enabled" className="text-sm font-normal">Habilitar verificación automática</Label>
            <Switch id="health-enabled" checked={healthEnabled} onCheckedChange={setHealthEnabled} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="health-interval" className={fieldLabel}>Intervalo</Label>
            <Select value={interval} onValueChange={setIntervalMin} disabled={!healthEnabled}>
              <SelectTrigger id="health-interval" aria-label="Intervalo" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set(['5', '15', '30', '60', '360', interval])]
                  .sort((a, b) => Number(a) - Number(b))
                  .map((m) => (
                    <SelectItem key={m} value={m}>{intervalLabel(Number(m))}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <span className={hint}>
            Timeout de 5 s por stream. Si un canal falla 3 veces seguidas, se cambia a su mejor alternativa.
          </span>
          <Button
            className={saveButton}
            disabled={pending}
            onClick={() => save({ health_check_enabled: healthEnabled ? '1' : '0', health_check_interval_minutes: interval })}
          >
            Guardar
          </Button>
        </section>

        <section aria-label="Detección de duplicados" className={section}>
          <h2 className={sectionTitle}>Detección de duplicados</h2>
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px] text-muted-foreground">
              <Label htmlFor="dup-threshold" className="font-normal">Umbral de similitud</Label>
              <span className="font-mono text-primary">{dupThreshold}%</span>
            </div>
            <Slider
              id="dup-threshold"
              aria-label="Umbral de similitud"
              min={60}
              max={100}
              step={1}
              value={[dupThreshold]}
              onValueChange={([v]) => setDupThreshold(v)}
              className="h-8"
            />
            <div className="flex justify-between font-mono text-[11px] text-label">
              <span>60% · más resultados</span>
              <span>100% · exactos</span>
            </div>
          </div>
          <Button
            className={saveButton}
            disabled={pending}
            onClick={() => save({ duplicate_threshold: String(dupThreshold) })}
          >
            Guardar
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="¿Regenerar el token?"
        description="El link actual dejará de funcionar. Vas a tener que actualizar la URL en TiviMate y en las demás apps."
        confirmLabel="Regenerar"
        onConfirm={handleRegenerate}
      />
    </>
  )
}
