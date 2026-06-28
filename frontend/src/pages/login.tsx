import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Tv, Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Por favor completá todos los campos.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
      navigate('/channels', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credenciales inválidas.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background gradient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% -20%, hsl(270 72% 62% / 0.12), transparent)',
        }}
      />

      <div className="w-full max-w-sm animate-fade-in-up relative">
        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center mb-4 shadow-[0_0_30px_-5px_hsl(270_72%_62%_/_0.4)]">
              <Tv className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">IPTV Manager</h1>
            <p className="text-sm text-muted-foreground mt-1">Panel de Administración</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                disabled={loading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Iniciando sesión...
                </>
              ) : (
                'Iniciar sesión'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
