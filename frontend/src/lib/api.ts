// Custom error types
export class AuthError extends Error {
  constructor() {
    super('Authentication required')
    this.name = 'AuthError'
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Auth error event for global handling
const authErrorEvent = new EventTarget()
export const onAuthError = (cb: () => void) => {
  authErrorEvent.addEventListener('auth-error', cb as EventListener)
  return () => authErrorEvent.removeEventListener('auth-error', cb as EventListener)
}
const dispatchAuthError = () => authErrorEvent.dispatchEvent(new Event('auth-error'))

function getCsrfToken(): string | null {
  // In production cookies are __Host-prefixed, in dev they're plain
  const names = ['__Host-csrf', 'csrf']
  for (const name of names) {
    const match = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))
    if (match) return decodeURIComponent(match.split('=')[1])
  }
  return null
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { rawText?: boolean }
): Promise<T> {
  const headers: Record<string, string> = {}

  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
  })

  if (res.status === 401) {
    dispatchAuthError()
    throw new AuthError()
  }

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      errorMsg = data.error || errorMsg
    } catch {
      // ignore parse errors
    }
    throw new ApiError(errorMsg, res.status)
  }

  // Handle plain text responses (raw editor)
  if (options?.rawText) {
    return (await res.text()) as T
  }

  const contentType = res.headers.get('content-type')
  if (contentType?.includes('text/plain')) {
    return (await res.text()) as T
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T
  }

  return res.json()
}

export const api = {
  get: <T>(path: string, opts?: { rawText?: boolean }) =>
    request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown) =>
    request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) =>
    request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', path, body),
  delete: <T>(path: string) =>
    request<T>('DELETE', path),
}
