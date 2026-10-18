import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { Radio, FolderOpen, Link, Copy, FileCode, Activity, Settings, LogOut, Tv, Menu, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { useHealthStatus, useDuplicates } from '@/hooks/use-health'
import { useSettings } from '@/hooks/use-settings'
import { useGroups } from '@/hooks/use-groups'
import { useSources } from '@/hooks/use-sources'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

interface NavItem {
  to: string
  icon: React.ElementType
  label: string
  count?: string
  warn?: boolean
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { data: health } = useHealthStatus()
  const { data: groups } = useGroups()
  const { data: sources } = useSources()
  const { data: settings } = useSettings()
  // Caro de calcular en el servidor: se cachea 10 min y recién corre cuando se conoce el umbral
  const { data: dups } = useDuplicates(Number(settings?.duplicate_threshold) || 80, {
    enabled: !!settings,
    staleTime: 10 * 60 * 1000,
  })

  const fmt = (n: number | undefined) => (n === undefined ? undefined : n.toLocaleString('es-AR'))
  const down = health?.summary.down ?? 0
  const groupList = groups?.groups
  const sourceList = sources?.sources

  const sections: { label: string; items: NavItem[] }[] = [
    {
      label: 'Gestión',
      items: [
        { to: '/channels', icon: Radio, label: 'Canales', count: fmt(health?.summary.total) },
        { to: '/groups', icon: FolderOpen, label: 'Grupos', count: fmt(groupList?.length) },
        { to: '/sources', icon: Link, label: 'Fuentes M3U', count: fmt(sourceList?.length) },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { to: '/duplicates', icon: Copy, label: 'Duplicados', count: fmt(dups?.count) },
        { to: '/raw-editor', icon: FileCode, label: 'Editor Raw' },
        { to: '/checker', icon: ShieldCheck, label: 'IPTV Checker' },
      ],
    },
    {
      label: 'Monitoreo',
      items: [
        {
          to: '/health',
          icon: Activity,
          label: 'Health Status',
          count: down > 0 ? `${fmt(down)} caídos` : undefined,
          warn: down > 0,
        },
      ],
    },
    { label: 'Sistema', items: [{ to: '/settings', icon: Settings, label: 'Configuración' }] },
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <nav aria-label="Principal" className="flex h-full flex-col gap-[22px] bg-sidebar px-3.5 py-5 text-foreground">
      <NavLink to="/channels" onClick={onNavigate} className="flex items-center gap-2.5 px-2 no-underline">
        <span className="flex size-[30px] items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Tv aria-hidden="true" className="size-4" strokeWidth={2.2} />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-bold tracking-[0.02em]">IPTV MANAGER</span>
          <span className="font-mono text-[11px] text-label">
            en vivo{sourceList ? ` · ${sourceList.length} ${sourceList.length === 1 ? 'fuente' : 'fuentes'}` : ''}
          </span>
        </span>
      </NavLink>

      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            <span className="px-2.5 pb-1.5 font-mono text-[10px] tracking-[0.12em] text-faint uppercase">
              {section.label}
            </span>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center justify-between rounded-[7px] px-2.5 text-sm font-medium no-underline transition-colors',
                    isActive ? 'bg-muted text-white' : 'text-muted-foreground hover:bg-raised hover:text-foreground'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-2.5">
                      <item.icon aria-hidden="true" className={cn('size-4', isActive && 'text-primary')} />
                      {item.label}
                    </span>
                    {item.count && (
                      <span className={cn('font-mono text-[11px]', item.warn ? 'text-destructive' : 'text-label')}>
                        {item.count}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border px-2.5 pt-3.5">
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold">{user?.username ?? 'admin'}</span>
          <span className="text-xs text-label">Administrador</span>
        </span>
        <Button variant="secondary" size="icon" onClick={handleLogout} aria-label="Cerrar sesión">
          <LogOut aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop */}
      <aside className="fixed top-0 bottom-0 left-0 z-30 hidden w-[232px] border-r border-border bg-sidebar md:block">
        <SidebarContent />
      </aside>

      {/* Mobile: Sheet */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" size="icon" className="fixed top-3 left-3 z-40" aria-label="Abrir menú">
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" showCloseButton={false} className="w-[260px] border-r border-border bg-sidebar p-0">
            <SheetTitle className="sr-only">Menú</SheetTitle>
            <SheetDescription className="sr-only">Navegación principal</SheetDescription>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
