import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: number | string
  color?: 'purple' | 'green' | 'amber' | 'red' | 'slate' | 'orange'
  className?: string
}

const colorMap = {
  purple: {
    icon: 'text-purple-400',
    iconBg: 'bg-purple-500/10',
    value: 'text-purple-300',
  },
  green: {
    icon: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    value: 'text-emerald-300',
  },
  amber: {
    icon: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    value: 'text-amber-300',
  },
  red: {
    icon: 'text-red-400',
    iconBg: 'bg-red-500/10',
    value: 'text-red-300',
  },
  slate: {
    icon: 'text-slate-400',
    iconBg: 'bg-slate-500/10',
    value: 'text-slate-300',
  },
  orange: {
    icon: 'text-orange-400',
    iconBg: 'bg-orange-500/10',
    value: 'text-orange-300',
  },
}

export function StatCard({ icon: Icon, label, value, color = 'purple', className }: StatCardProps) {
  const colors = colorMap[color]
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-4 flex items-center gap-4',
        'transition-all duration-200 hover:-translate-y-0.5 hover:border-border/80 hover:shadow-lg',
        className
      )}
    >
      <div className={cn('p-2.5 rounded-lg flex-shrink-0', colors.iconBg)}>
        <Icon className={cn('w-5 h-5', colors.icon)} />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  )
}
