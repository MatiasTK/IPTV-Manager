import { useState, useEffect, useRef } from 'react'
import { FileCode, Download, RefreshCw, Check, Loader2, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export default function RawEditorPage() {
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const originalRef = useRef('')

  const loadContent = async () => {
    setIsLoading(true)
    try {
      const text = await api.get<string>('/api/raw/preview', { rawText: true })
      setContent(text)
      originalRef.current = text
      setIsDirty(false)
    } catch {
      toast.error('Error al cargar el M3U')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadContent()
  }, [])

  const handleChange = (value: string) => {
    setContent(value)
    setIsDirty(value !== originalRef.current)
  }

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error('El contenido no puede estar vacío')
      return
    }
    if (!content.trimStart().toLowerCase().startsWith('#extm3u')) {
      toast.error('El M3U debe comenzar con #EXTM3U')
      return
    }
    setIsSaving(true)
    try {
      const res = await api.put<{ ok: boolean; activeChannels: number }>('/api/raw/apply', { text: content })
      toast.success(`Cambios aplicados. ${res.activeChannels} canales activos.`)
      originalRef.current = content
      setIsDirty(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aplicar cambios')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'audio/mpegurl;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'playlist.m3u'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const lineCount = content.split('\n').length

  return (
    <div className="flex flex-col gap-4 h-full">
      <PageHeader
        title="Editor Raw M3U"
        subtitle="Edición directa de la playlist generada"
        icon={FileCode}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{lineCount} líneas</span>
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={isLoading}>
              <Download className="w-4 h-4 mr-2" />
              Descargar .m3u
            </Button>
            <Button variant="outline" size="sm" onClick={loadContent} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Recargar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving || isLoading || !isDirty}>
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Aplicar cambios{isDirty ? ' *' : ''}
            </Button>
          </div>
        }
      />

      <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-400">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <AlertDescription className="text-amber-400/90 text-xs">
          Los cambios en este editor modifican la base de datos directamente. Canales nuevos se crean, editados se actualizan, y eliminados se desactivan.
        </AlertDescription>
      </Alert>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="h-[500px] rounded-xl border border-border bg-[hsl(240_10%_4%)] animate-pulse" />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            className="h-[calc(100vh-300px)] min-h-[500px] font-mono text-xs resize-none bg-[hsl(240_10%_4%)] border-border/60 focus:border-primary/50"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-name=&quot;Canal&quot;,Canal&#10;http://..."
          />
        )}
      </div>
    </div>
  )
}
