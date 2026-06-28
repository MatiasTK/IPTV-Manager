import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  icon?: LucideIcon
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-6', className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </div>
  )
}
