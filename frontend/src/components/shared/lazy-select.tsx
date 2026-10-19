import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface LazySelectProps {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  ariaLabel?: string
  className?: string
}

/**
 * Select that only renders its options while open (plus the selected one so the
 * trigger keeps its label). Radix otherwise builds every <SelectItem> up front,
 * which with ~800 groups made each render of the page expensive.
 */
export function LazySelect({ value, onValueChange, options, placeholder, ariaLabel, className }: LazySelectProps) {
  const [open, setOpen] = useState(false)
  const shown = open ? options : options.filter((o) => o.value === value)
  return (
    <Select value={value} onValueChange={onValueChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {shown.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
