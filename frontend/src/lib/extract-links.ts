// Extracción de enlaces Xtream / M3U desde texto libre (archivos muy grandes).
// Todo corre en el navegador: el archivo nunca se sube al servidor.

export interface ExtractedLink {
  /** Clave de deduplicación (host+usuario+clave para Xtream, URL para M3U) */
  key: string
  type: 'xtream' | 'm3u'
  /** URL lista para enviar a /api/checker/check */
  url: string
  host: string
  user?: string
  pass?: string
}

const URL_RE = /https?:\/\/[^\s"'<>\\|^`{}[\]()]+/gi
const TRAILING_JUNK = /[.,;:!?*]+$/

// "Host: http://x  User: abc  Pass: def" (con emojis, flechas, saltos de línea, etc.)
const LABELED_RE =
  /(?:host|server|servidor|portal|panel|dns|url)[\s:=\-➤»>|]*(https?:\/\/[^\s"'<>|]+)[\s\S]{0,200}?(?:user(?:name)?|usr|usuario)[\s:=\-➤»>|]*([^\s"'<>|]+)[\s\S]{0,120}?(?:pass(?:word)?|pwd|clave|contrase[ñn]a)[\s:=\-➤»>|]*([^\s"'<>|]+)/gi

function buildXtreamUrl(base: string, user: string, pass: string): string {
  return `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
}

function xtreamLink(base: string, user: string, pass: string): ExtractedLink | null {
  if (!user || !pass || /^https?:/i.test(user) || /^https?:/i.test(pass)) return null
  return {
    key: `x|${base.toLowerCase()}|${user}|${pass}`,
    type: 'xtream',
    url: buildXtreamUrl(base, user, pass),
    host: base,
    user,
    pass,
  }
}

function classifyUrl(raw: string): ExtractedLink | null {
  const clean = raw.replace(TRAILING_JUNK, '')
  let u: URL
  try { u = new URL(clean) } catch { return null }
  if (!u.hostname.includes('.') && !/^\[?[\da-f:]+\]?$/i.test(u.hostname) && u.hostname !== 'localhost') return null
  const base = `${u.protocol}//${u.host}`

  // ...?username=U&password=P (get.php, player_api.php, panel_api.php, etc.)
  const qUser = u.searchParams.get('username')
  const qPass = u.searchParams.get('password')
  if (qUser && qPass) return xtreamLink(base, qUser, qPass)

  // /live/U/P/123.ts, /movie/U/P/123.mp4, /series/U/P/123.mkv
  const m = u.pathname.match(/^\/(?:live|movie|series)\/([^/]+)\/([^/]+)\/[^/]+$/i)
  if (m) return xtreamLink(base, decodeURIComponent(m[1]), decodeURIComponent(m[2]))

  // Listas M3U sueltas (no streams individuales .m3u8 / .ts)
  if (/\.m3u$/i.test(u.pathname) || /[?&]type=m3u/i.test(u.search)) {
    return { key: `m|${clean}`, type: 'm3u', url: clean, host: base }
  }
  return null
}

/** Extrae enlaces de un fragmento de texto y los suma al mapa (dedup por key). */
export function extractFromText(text: string, into: Map<string, ExtractedLink>): void {
  for (const m of text.matchAll(URL_RE)) {
    const link = classifyUrl(m[0])
    if (link && !into.has(link.key)) into.set(link.key, link)
  }
  for (const m of text.matchAll(LABELED_RE)) {
    let base: string
    try { base = new URL(m[1].replace(TRAILING_JUNK, '')).origin } catch { continue }
    const link = xtreamLink(base, m[2].replace(TRAILING_JUNK, ''), m[3].replace(TRAILING_JUNK, ''))
    if (link && !into.has(link.key)) into.set(link.key, link)
  }
}

const CHUNK_BYTES = 8 * 1024 * 1024

/**
 * Lee el archivo en bloques de 8 MB (sin cargarlo entero en memoria) y extrae enlaces.
 * Los bloques se cortan en el último salto de línea para no partir enlaces.
 */
export async function extractFromFile(
  file: File,
  onProgress: (fraction: number, found: number) => void,
  signal?: AbortSignal,
): Promise<ExtractedLink[]> {
  const found = new Map<string, ExtractedLink>()
  const decoder = new TextDecoder('utf-8')
  let offset = 0
  let carry = ''

  while (offset < file.size) {
    if (signal?.aborted) break
    const end = Math.min(offset + CHUNK_BYTES, file.size)
    const buf = await file.slice(offset, end).arrayBuffer()
    offset = end
    const text = carry + decoder.decode(buf, { stream: offset < file.size })
    const cut = offset < file.size ? text.lastIndexOf('\n') : text.length
    const head = cut > 0 ? text.slice(0, cut) : text
    carry = cut > 0 ? text.slice(cut) : ''
    extractFromText(head, found)
    onProgress(offset / file.size, found.size)
    // ceder al navegador para que la UI no se congele
    await new Promise(r => setTimeout(r, 0))
  }
  if (carry && !signal?.aborted) extractFromText(carry, found)
  onProgress(1, found.size)
  return [...found.values()]
}
