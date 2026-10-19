import { useState, useEffect, useRef, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface RawSource {
  id: number
  name: string
  type: string
  channelCount: number
}

export default function RawEditorPage() {
  const [sources, setSources] = useState<RawSource[]>([])
  const [orphans, setOrphans] = useState(0)
  const [scope, setScope] = useState<string | null>(null)
  // Unsaved edits per tab, so switching tabs never loses work
  const draftsRef = useRef<Record<string, { content: string; original: string }>>({})

  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const originalRef = useRef('')
  const gutterRef = useRef<HTMLDivElement>(null)
  const [justSaved, setJustSaved] = useState(false)

  const loadContent = async (target: string | null = scope, force = true) => {
    if (target === null) return
    const draft = draftsRef.current[target]
    if (draft && !force) {
      setContent(draft.content)
      originalRef.current = draft.original
      setIsDirty(draft.content !== draft.original)
      setJustSaved(false)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const text = await api.get<string>(`/api/raw/preview?source=${target}`, { rawText: true })
      if (target !== scopeRef.current) return
      draftsRef.current[target] = { content: text, original: text }
      setContent(text)
      originalRef.current = text
      setIsDirty(false)
      setJustSaved(false)
    } catch {
      toast.error('Error al cargar el M3U')
    } finally {
      if (target === scopeRef.current) setIsLoading(false)
    }
  }

  const scopeRef = useRef<string | null>(null)
  scopeRef.current = scope

  useEffect(() => {
    api
      .get<{ sources: RawSource[]; orphans: number }>('/api/raw/sources')
      .then((res) => {
        setSources(res.sources)
        setOrphans(res.orphans)
        const first = res.sources.find((s) => s.channelCount > 0) ?? res.sources[0]
        setScope(first ? String(first.id) : res.orphans > 0 ? 'none' : null)
        if (!first && res.orphans === 0) setIsLoading(false)
      })
      .catch(() => {
        toast.error('Error al cargar las fuentes')
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    if (scope !== null) loadContent(scope, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  const switchScope = (next: string) => {
    if (scope !== null) draftsRef.current[scope] = { content, original: originalRef.current }
    scopeRef.current = next
    setScope(next)
  }

  const handleChange = (value: string) => {
    setContent(value)
    if (scope !== null) draftsRef.current[scope] = { content: value, original: originalRef.current }
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
      const res = await api.put<{ ok: boolean; activeChannels: number; sourceChannels: number }>(
        `/api/raw/apply?source=${scope}`,
        { text: content }
      )
      toast.success(`Cambios aplicados. ${res.sourceChannels} canales en esta fuente, ${res.activeChannels} activos en total.`)
      originalRef.current = content
      if (scope !== null) draftsRef.current[scope] = { content, original: content }
      if (scope === 'none') setOrphans(res.sourceChannels)
      else setSources((prev) => prev.map((s) => (String(s.id) === scope ? { ...s, channelCount: res.sourceChannels } : s)))
      setIsDirty(false)
      setJustSaved(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aplicar cambios')
    } finally {
      setIsSaving(false)
    }
  }

  const activeName = scope === 'none' ? 'sin-fuente' : sources.find((s) => String(s.id) === scope)?.name
  const [query, setQuery] = useState('')
  const visibleSources = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sources.filter((s) => s.name.toLowerCase().includes(q)) : sources
  }, [sources, query])
  const dirtyTabs = (id: string) => (id === scope ? isDirty : (draftsRef.current[id]?.content ?? '') !== (draftsRef.current[id]?.original ?? ''))


  const sourceRow = (id: string, name: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => switchScope(id)}
      aria-current={id === scope ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:text-foreground ${
        id === scope ? 'bg-active text-foreground' : 'text-muted-foreground'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {dirtyTabs(id) && <span aria-label="sin guardar" className="size-1.5 shrink-0 rounded-full bg-[#F2A33A]" />}
      <span className="shrink-0 font-mono text-[11px] text-label">{count.toLocaleString('es-AR')}</span>
    </button>
  )

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'audio/mpegurl;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(activeName || 'playlist').replace(/[^\w.-]+/g, '_')}.m3u`
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
            <Button variant="secondary" onClick={() => loadContent()} disabled={isLoading || scope === null}>
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
        Cada pestaña edita una sola fuente: los canales nuevos se crean en ella, los editados se actualizan y los eliminados se desactivan. Las demás fuentes no se tocan.
      </p>

      <div className="flex flex-wrap items-start gap-[22px]">
        <section aria-label="Editor" className="flex min-w-0 flex-[3_1_560px] flex-col overflow-hidden rounded-[10px] border border-border bg-[#0B0D0F]">
          <div className="flex items-center justify-between border-b border-border bg-card px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
            <span>{activeName ?? 'playlist'}.m3u</span>
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
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card p-4">
            <h2 className="text-[15px] font-bold">Fuentes <span className="font-mono text-xs font-normal text-label">{sources.length}</span></h2>
            {sources.length > 6 && (
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar fuentes…"
                aria-label="Filtrar fuentes"
              />
            )}
            <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
              {visibleSources.map((s) => sourceRow(String(s.id), s.name, s.channelCount))}
              {orphans > 0 && !query && sourceRow('none', 'Sin fuente', orphans)}
              {visibleSources.length === 0 && <span className="px-2.5 py-1.5 text-[13px] text-label">Sin resultados</span>}
            </div>
          </div>
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
