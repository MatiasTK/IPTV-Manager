import { useState, useEffect, useRef, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export default function RawEditorPage() {
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const originalRef = useRef('')
  const gutterRef = useRef<HTMLDivElement>(null)
  const [justSaved, setJustSaved] = useState(false)

  const loadContent = async () => {
    setIsLoading(true)
    try {
      const text = await api.get<string>('/api/raw/preview', { rawText: true })
      setContent(text)
      originalRef.current = text
      setIsDirty(false)
      setJustSaved(false)
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
    setJustSaved(false)
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
      setJustSaved(true)
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

  const lines = useMemo(() => content.split('\n'), [content])
  const lineCount = lines.length
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join('\n'), [lines])

  const stats = useMemo(() => {
    let entries = 0
    let orphan = 0
    let noLogo = 0
    lines.forEach((l, i) => {
      if (!l.startsWith('#EXTINF')) return
      entries++
      if (!(lines[i + 1] ?? '').trim().match(/^[a-z]+:\/\//i)) orphan++
      if (!l.includes('tvg-logo')) noLogo++
    })
    const header = lines[0]?.trimStart().toLowerCase().startsWith('#extm3u') ?? false
    const hasEpg = header && /x-tvg-url|url-tvg/i.test(lines[0])
    return { entries, orphan, noLogo, header, hasEpg }
  }, [lines])

  const checks = [
    {
      title: 'Cabecera #EXTM3U',
      detail: stats.header ? (stats.hasEpg ? 'Presente, con guía EPG' : 'Presente') : 'Falta en la primera línea',
      color: stats.header ? '#5AD1A0' : '#FF7A6B',
    },
    { title: `${stats.entries.toLocaleString('es-AR')} canales`, detail: 'Cada #EXTINF con su URL', color: stats.orphan ? '#FF7A6B' : '#5AD1A0' },
    {
      title: stats.orphan ? `${stats.orphan} entradas sin URL` : 'Sin entradas huérfanas',
      detail: stats.orphan ? 'Revisá la línea siguiente a cada #EXTINF' : 'Todo en orden',
      color: stats.orphan ? '#FF7A6B' : '#5AD1A0',
    },
    {
      title: `${stats.noLogo.toLocaleString('es-AR')} canales sin logo`,
      detail: 'TiviMate mostrará el nombre en su lugar',
      color: stats.noLogo ? '#F2C14E' : '#5AD1A0',
    },
  ]

  // Ctrl/Cmd+S guarda
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  const canSaveRef = useRef(false)
  canSaveRef.current = isDirty && !isSaving && !isLoading
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (canSaveRef.current) saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statusLine = justSaved
    ? 'GUARDADO · PLAYLIST REGENERADA'
    : isDirty
      ? 'CAMBIOS SIN GUARDAR'
      : 'SINCRONIZADO CON LA PLAYLIST'
  const statusColor = justSaved ? '#5AD1A0' : isDirty ? '#F2A33A' : '#8A929B'

  return (
    <>
      <PageHeader
        title="Editor Raw M3U"
        subtitle="Edición directa de la playlist generada. Los cambios se aplican al guardar."
        status={statusLine}
        statusColor={statusColor}
        actions={
          <>
            <Button variant="secondary" onClick={handleDownload} disabled={isLoading}>
              Descargar .m3u
            </Button>
            <Button variant="secondary" onClick={loadContent} disabled={isLoading}>
              {isLoading && <Loader2 aria-hidden="true" className="animate-spin" />}
              Recargar
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isLoading || !isDirty}>
              {isSaving && <Loader2 aria-hidden="true" className="animate-spin" />}
              Guardar cambios
            </Button>
          </>
        }
      />

      <p className="rounded-[10px] border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <span className="mr-2 font-mono text-degraded">AVISO</span>
        Los cambios en este editor modifican la base de datos directamente: los canales nuevos se crean, los editados se actualizan y los eliminados se desactivan.
      </p>

      <div className="flex flex-wrap items-start gap-[22px]">
        <section aria-label="Editor" className="flex min-w-0 flex-[3_1_560px] flex-col overflow-hidden rounded-[10px] border border-border bg-[#0B0D0F]">
          <div className="flex items-center justify-between border-b border-border bg-card px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
            <span>playlist.m3u</span>
            <span>UTF-8 · LF · {lineCount.toLocaleString('es-AR')} líneas</span>
          </div>
          {isLoading ? (
            <div className="h-[640px] animate-pulse bg-[#0B0D0F]" />
          ) : (
            <div className="flex h-[640px]">
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="shrink-0 overflow-hidden border-r border-[#1B1F24] bg-background px-2.5 py-3.5 text-right font-mono text-[13px] leading-[22px] whitespace-pre text-[#4A525B] select-none"
              >
                {gutter}
              </div>
              <textarea
                aria-label="Contenido de la playlist"
                value={content}
                onChange={(e) => handleChange(e.target.value)}
                onScroll={(e) => {
                  if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
                }}
                wrap="off"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                placeholder={'#EXTM3U\n#EXTINF:-1 tvg-name="Canal",Canal\nhttp://...'}
                className="min-w-0 flex-1 resize-none overflow-auto border-0 bg-transparent px-4 py-3.5 font-mono text-[13px] leading-[22px] whitespace-pre text-[#C9CED4] outline-none [tab-size:2]"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 border-t border-border bg-card px-3.5 py-2 font-mono text-[11px] text-label">
            <span>{stats.entries.toLocaleString('es-AR')} entradas</span>
            <span>{(stats.orphan + stats.noLogo).toLocaleString('es-AR')} advertencias</span>
            <span className="ml-auto">Ctrl+S para guardar</span>
          </div>
        </section>

        <aside aria-label="Resumen" className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5">
          <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4">
            <h2 className="text-[15px] font-bold">Validación</h2>
            {checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[13px]">
                <span aria-hidden="true" className="mt-[5px] size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-label">{c.detail}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card p-4">
            <h2 className="text-[15px] font-bold">Atributos soportados</h2>
            <span className="font-mono text-xs leading-[1.8] text-muted-foreground">
              tvg-id · tvg-name · tvg-logo · group-title · catchup · catchup-days · catchup-source · http-user-agent · http-referrer
            </span>
          </div>
        </aside>
      </div>
    </>
  )
}
