import { X } from 'lucide-react'

/** Groups this source never imports. Removing one only takes effect on the next sync. */
export function ExcludedGroupsEditor({ groups, onChange }: { groups: string[]; onChange: (next: string[]) => void }) {
  if (groups.length === 0) return null
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] tracking-[0.08em] text-label uppercase">Grupos excluidos ({groups.length})</span>
        <p className="text-xs text-muted-foreground">
          La sincronización no los importa. Quitá uno para que vuelva a entrar en la próxima sincronización.
        </p>
      </div>
      <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {groups.map((g) => (
          <li key={g}>
            <button
              type="button"
              aria-label={`Quitar exclusión de ${g}`}
              onClick={() => onChange(groups.filter((x) => x !== g))}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-control px-2.5 text-xs text-[#C9CED4] transition-colors hover:bg-raised hover:text-foreground"
            >
              {g}
              <X aria-hidden="true" className="size-3 text-label" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
