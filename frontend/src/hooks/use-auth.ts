import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, onAuthError, ApiError } from '@/lib/api'
import type { User } from '@/lib/types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function useAuthProvider() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const checkAuth = useCallback(async () => {
    try {
      const data = await api.get<User>('/api/auth/me')
      setUser(data)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
    const cleanup = onAuthError(() => setUser(null))
    return cleanup
  }, [checkAuth])

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Error desconocido' }))
      throw new ApiError(data.error || 'Credenciales inválidas', res.status)
    }
    await checkAuth()
  }, [checkAuth])

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout') } catch { /* ignore */ }
    setUser(null)
  }, [])

  return { user, isLoading, login, logout }
}
