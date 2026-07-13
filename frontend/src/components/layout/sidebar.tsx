import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import {
  Radio, FolderOpen, Link, Copy, FileCode, Activity,
  Settings, LogOut, Tv, ChevronLeft, ChevronRight, Menu, X, ShieldCheck
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { useHealthStatus } from '@/hooks/use-health'
import { HealthDot } from '@/components/shared/health-badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { HealthStatus } from '@/lib/types'

interface NavItem {
  to: string
  icon: React.ElementType
  label: string
  badge?: number
  showHealthDot?: boolean
}

const navSections = [
  {
    label: 'Gestión',
    items: [
      { to: '/channels', icon: Radio, label: 'Canales' },
      { to: '/groups', icon: FolderOpen, label: 'Grupos' },
      { to: '/sources', icon: Link, label: 'Fuentes M3U' },
    ] as NavItem[],
  },
  {
    label: 'Herramientas',
    items: [
      { to: '/duplicates', icon: Copy, label: 'Duplicados' },
      { to: '/raw-editor', icon: FileCode, label: 'Editor Raw' },
      { to: '/checker', icon: ShieldCheck, label: 'IPTV Checker' },
    ] as NavItem[],
  },
  {
    label: 'Monitoreo',
    items: [
      { to: '/health', icon: Activity, label: 'Health Status', showHealthDot: true },
    ] as NavItem[],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/settings', icon: Settings, label: 'Configuración' },
    ] as NavItem[],
  },
]

function NavItemComponent({
  item,
  collapsed,
  healthStatus,
}: {
  item: NavItem
  collapsed: boolean
  healthStatus?: HealthStatus
}) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          isActive && 'bg-primary/10 text-primary border-l-2 border-primary pl-[10px]',
          collapsed && 'justify-center px-2'
        )
      }
      title={collapsed ? item.label : undefined}
    >
      <item.icon className="w-4 h-4 flex-shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1">{item.label}</span>
          {item.showHealthDot && healthStatus && (
            <HealthDot status={healthStatus} size="sm" />
          )}
        </>
      )}
    </NavLink>
  )
}

function SidebarContent({
  collapsed,
  onCollapse,
}: {
  collapsed: boolean
  onCollapse?: () => void
}) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { data: healthData } = useHealthStatus()

  const overallHealth: HealthStatus = healthData?.summary
    ? healthData.summary.down > 0
      ? 'down'
      : healthData.summary.degraded > 0
        ? 'degraded'
        : 'healthy'
    : 'unknown'

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={cn('flex items-center p-4', collapsed ? 'justify-center' : 'justify-between')}>
        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Tv className="w-4 h-4 text-primary" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm text-foreground">IPTV Manager</span>
          )}
        </div>
        {onCollapse && !collapsed && (
          <button
            onClick={onCollapse}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {onCollapse && collapsed && (
          <button
            onClick={onCollapse}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <Separator className="mx-3 w-auto" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {navSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItemComponent
                  key={item.to}
                  item={item}
                  collapsed={collapsed}
                  healthStatus={item.showHealthDot ? overallHealth : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Separator className="mx-3 w-auto" />

      {/* Footer */}
      <div className={cn('p-3', collapsed && 'flex flex-col items-center')}>
        {!collapsed && user && (
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-medium text-foreground">{user.username}</p>
            <p className="text-xs text-muted-foreground">Administrador</p>
          </div>
        )}
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          onClick={handleLogout}
          className={cn(
            'text-muted-foreground hover:text-destructive w-full',
            !collapsed && 'justify-start gap-2'
          )}
          title={collapsed ? 'Cerrar sesión' : undefined}
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && 'Cerrar sesión'}
        </Button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-30',
          'bg-[hsl(var(--color-sidebar,240_10%_5%))] border-r border-[hsl(var(--color-sidebar-border,240_5%_13%))]',
          'transition-all duration-300',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        <SidebarContent collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} />
      </aside>

      {/* Mobile sidebar via Sheet */}
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="fixed top-3 left-3 z-40">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-64 bg-[hsl(240_10%_5%)] border-r border-[hsl(240_5%_13%)]">
            <SidebarContent collapsed={false} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
