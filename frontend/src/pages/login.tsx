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
    <div className="flex min-h-screen flex-wrap bg-background text-foreground">
      <section
        aria-label="Estado del sistema"
        className="flex flex-[1_1_480px] flex-col justify-between gap-12 border-r border-border bg-card p-6 md:p-12"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-[34px] items-center justify-center rounded-[7px] bg-primary text-primary-foreground">
            <Tv aria-hidden="true" className="size-[18px]" strokeWidth={2.2} />
          </span>
          <span className="text-[15px] font-bold tracking-[0.02em]">IPTV MANAGER</span>
        </div>
        <div className="flex max-w-[460px] flex-col gap-5">
          <span className="font-mono text-xs text-primary">● PANEL DE ADMINISTRACIÓN</span>
          <h1 className="text-[32px] leading-[1.08] font-bold tracking-[-0.02em] md:text-[44px]">
            Una sola playlist, todas tus fuentes, siempre verificadas.
          </h1>
          <p className="text-base leading-[1.55] text-muted-foreground">
            Combiná listas M3U y Xtream en un link estable para TiviMate, con chequeo de salud y cambio automático a
            alternativas.
          </p>
        </div>
        <dl className="grid max-w-[520px] grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-border bg-border">
          {[
            ['Fuentes', 'M3U + Xtream', undefined],
            ['Health', 'Automático', '#5AD1A0'],
            ['Salida', '1 link', undefined],
          ].map(([label, value, color]) => (
            <div key={label} className="flex flex-col gap-1 bg-background px-4 py-3.5">
              <dt className="text-[11px] tracking-[0.08em] text-label uppercase">{label}</dt>
              <dd className="font-mono text-base md:text-xl" style={color ? { color } : undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <main className="flex flex-[1_1_420px] items-center justify-center px-6 py-12">
        <form onSubmit={handleSubmit} className="flex w-full max-w-[380px] flex-col gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[28px] font-bold">Ingresar</h2>
            <span className="text-sm text-label">Usá tu cuenta de administrador.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username" className="text-[13px] font-normal text-muted-foreground">
              Usuario
            </Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              disabled={loading}
              className="h-12 bg-card text-[15px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-[13px] font-normal text-muted-foreground">
              Contraseña
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              className="h-12 bg-card text-[15px]"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" size="lg" className="mt-1.5 w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                Iniciando sesión...
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
          <span className="text-center font-mono text-[11px] text-faint">
            Sesión protegida · límite de intentos activo
          </span>
        </form>
      </main>
    </div>
  )
}
