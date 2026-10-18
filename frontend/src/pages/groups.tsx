import { useState } from 'react'
import { FolderOpen, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup, useReorderGroups,
  useAutoSuggestGroups, useApplyAutoSuggest, useDeleteEmptyGroups
} from '@/hooks/use-groups'
import { useHealthChannels } from '@/hooks/use-health'
import { STATUS_COLOR } from '@/lib/status'
import type { Group } from '@/lib/types'
import { toast } from 'sonner'

export default function GroupsPage() {
  const { data, isLoading } = useGroups()
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const deleteGroup = useDeleteGroup()
  const reorderGroups = useReorderGroups()
  const deleteEmptyGroups = useDeleteEmptyGroups()

  const [formOpen, setFormOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<Group | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)
  const [deleteChannels, setDeleteChannels] = useState(false)
  const [deleteEmptyConfirmOpen, setDeleteEmptyConfirmOpen] = useState(false)
  const [name, setName] = useState('')

  // Auto-suggest (panel lateral)
  const { data: suggestData, isLoading: suggestLoading } = useAutoSuggestGroups(true)
  const applySuggest = useApplyAutoSuggest()
  const { data: healthData } = useHealthChannels()

  const groups = data?.groups ?? []
  const emptyGroupsCount = groups.filter((g) => g.channel_count === 0).length
  const suggestions = suggestData?.suggestions ?? []
  const suggestedChannels = suggestions.reduce((n, x) => n + x.channels.length, 0)

  // Salud por grupo, derivada de /api/health/channels
  const healthByGroup = new Map<string, { ok: number; deg: number; down: number; total: number }>()
  for (const ch of healthData?.channels ?? []) {
    if (!ch.group_name) continue
    const e = healthByGroup.get(ch.group_name) ?? { ok: 0, deg: 0, down: 0, total: 0 }
    e.total++
    if (ch.health_status === 'healthy') e.ok++
    else if (ch.health_status === 'degraded' || ch.health_status === 'intermittent') e.deg++
    else if (ch.health_status === 'down') e.down++
    healthByGroup.set(ch.group_name, e)
  }

  const handleApply = async (items: typeof suggestions) => {
    if (items.length === 0) return
    try {
      await applySuggest.mutateAsync(
        items.map((x) => ({ groupName: x.groupName, channelIds: x.channels.map((ch) => ch.id) }))
      )
      toast.success('Agrupamientos aplicados correctamente')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aplicar agrupamiento')
    }
  }

  const handleOpenCreate = () => {
    setEditGroup(null)
    setName('')
    setFormOpen(true)
  }

  const handleOpenEdit = (g: Group) => {
    setEditGroup(g)
    setName(g.name)
    setFormOpen(true)
  }

  const handleSave = async () => {
    if (!name.trim()) return
    try {
      if (editGroup) {
        await updateGroup.mutateAsync({ id: editGroup.id, name: name.trim() })
        toast.success('Grupo actualizado')
      } else {
        await createGroup.mutateAsync(name.trim())
        toast.success('Grupo creado')
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteGroup.mutateAsync({ id: deleteTarget.id, deleteChannels })
      toast.success('Grupo eliminado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeleteTarget(null)
      setDeleteChannels(false)
    }
  }

  const handleReorder = async (index: number, direction: 'up' | 'down') => {
    const newGroups = [...groups]
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    const temp = newGroups[index]
    newGroups[index] = newGroups[targetIdx]
    newGroups[targetIdx] = temp

    const order = newGroups.map((g, idx) => ({ id: g.id, sort_order: idx + 1 }))
    try {
      await reorderGroups.mutateAsync(order)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al reordenar')
    }
  }

  const handleDeleteEmpty = async () => {
    try {
      const res = await deleteEmptyGroups.mutateAsync()
      toast.success(`Se eliminaron ${res.deletedCount} grupos vacíos`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar grupos')
    } finally {
      setDeleteEmptyConfirmOpen(false)
    }
  }

  const sortedOrderLabel = (idx: number) => String(idx + 1).padStart(2, '0')

  return (
    <>
      <PageHeader
        title="Grupos"
        subtitle="El orden de esta lista es el orden en que aparecen en TiviMate."
        status={`${groups.length} ${groups.length === 1 ? 'GRUPO' : 'GRUPOS'} · ${emptyGroupsCount} ${emptyGroupsCount === 1 ? 'VACÍO' : 'VACÍOS'}`}
        actions={
          <>
            {emptyGroupsCount > 0 && (
              <Button variant="destructive" onClick={() => setDeleteEmptyConfirmOpen(true)} disabled={deleteEmptyGroups.isPending}>
                <Trash2 aria-hidden="true" />
                Eliminar grupos vacíos ({emptyGroupsCount})
              </Button>
            )}
            <Button onClick={handleOpenCreate}>
              <Plus aria-hidden="true" />
              Nuevo grupo
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-[22px]">
        <section aria-label="Lista de grupos" className="min-w-0 flex-[2_1_560px] overflow-hidden rounded-[10px] border border-border bg-card">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16 px-4">Orden</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead className="text-right">Canales</TableHead>
                <TableHead className="w-[28%]">Salud</TableHead>
                <TableHead className="w-[200px] text-right"><span className="pr-2">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : groups.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5}>
                    <EmptyState
                      icon={FolderOpen}
                      title="No hay grupos"
                      description="Los grupos se crean automáticamente al importar listas."
                      action={{ label: 'Crear grupo', onClick: handleOpenCreate }}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((group, idx) => {
                  const h = healthByGroup.get(group.name)
                  const pct = (n: number) => (h && h.total > 0 ? (n / h.total) * 100 : 0)
                  return (
                    <TableRow key={group.id} className="h-14">
                      <TableCell className="px-4 font-mono text-xs text-label">{sortedOrderLabel(idx)}</TableCell>
                      <TableCell className="font-semibold">{group.name}</TableCell>
                      <TableCell className="text-right font-mono text-[#C9CED4]">
                        {group.channel_count === 0 ? <span className="text-label">vacío</span> : group.channel_count.toLocaleString('es-AR')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div aria-hidden="true" className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-[3px] bg-border">
                            <span style={{ width: `${pct(h?.ok ?? 0)}%`, background: STATUS_COLOR.healthy }} />
                            <span style={{ width: `${pct(h?.deg ?? 0)}%`, background: STATUS_COLOR.degraded }} />
                            <span style={{ width: `${pct(h?.down ?? 0)}%`, background: STATUS_COLOR.down }} />
                          </div>
                          <span className="min-w-9 font-mono text-[11px] text-label">
                            {h && h.total > 0 ? `${Math.round(pct(h.ok))}%` : '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="secondary" size="icon-sm" aria-label={`Subir ${group.name}`} disabled={idx === 0 || reorderGroups.isPending} onClick={() => handleReorder(idx, 'up')}>
                            <ArrowUp aria-hidden="true" />
                          </Button>
                          <Button variant="secondary" size="icon-sm" aria-label={`Bajar ${group.name}`} disabled={idx === groups.length - 1 || reorderGroups.isPending} onClick={() => handleReorder(idx, 'down')}>
                            <ArrowDown aria-hidden="true" />
                          </Button>
                          <Button variant="secondary" size="icon-sm" aria-label={`Editar ${group.name}`} onClick={() => handleOpenEdit(group)}>
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button variant="destructive" size="icon-sm" aria-label={`Eliminar ${group.name}`} onClick={() => setDeleteTarget(group)}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </section>

        <aside aria-label="Sugerencias de agrupamiento" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5 rounded-[10px] border border-border bg-card p-[18px]">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-primary">AUTO-AGRUPAMIENTO</span>
            <h2 className="text-[17px] font-bold">
              {suggestLoading ? 'Analizando canales…' : suggestions.length === 0 ? 'Todo agrupado' : `${suggestedChannels.toLocaleString('es-AR')} canales sin grupo`}
            </h2>
            <span className="text-[13px] leading-snug text-label">
              {suggestions.length === 0 && !suggestLoading
                ? 'No hay canales sin grupo para sugerir.'
                : 'Sugerencias según el nombre de cada canal.'}
            </span>
          </div>
          {suggestLoading && <Loader2 aria-label="Cargando" className="mx-auto size-5 animate-spin text-label" />}
          {suggestions.map((x) => (
            <div key={x.groupName} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold">{x.groupName}</span>
                <span className="truncate text-xs text-label">{x.channels.slice(0, 3).map((ch) => ch.name).join(', ')}{x.channels.length > 3 ? ' +' : ''}</span>
              </span>
              <span className="font-mono text-xs text-[#C9CED4]">{x.channels.length}</span>
              <Button variant="secondary" size="sm" onClick={() => handleApply([x])} disabled={applySuggest.isPending}>
                Aplicar
              </Button>
            </div>
          ))}
          {suggestions.length > 0 && (
            <Button onClick={() => handleApply(suggestions)} disabled={applySuggest.isPending}>
              {applySuggest.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Aplicar todas
            </Button>
          )}
        </aside>
      </div>

      {/* Form dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">{editGroup ? 'Editar grupo' : 'Nuevo grupo'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name" className="text-[13px] font-normal text-muted-foreground">Nombre del grupo</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Noticias"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!name.trim() || createGroup.isPending || updateGroup.isPending}>
              {(createGroup.isPending || updateGroup.isPending) && <Loader2 aria-hidden="true" className="animate-spin" />}
              {editGroup ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete group dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteChannels(false) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Eliminar grupo</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que deseas eliminar el grupo "{deleteTarget?.name}"?
            </p>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <Switch id="delete-channels-toggle" checked={deleteChannels} onCheckedChange={setDeleteChannels} />
              <div className="space-y-0.5">
                <Label htmlFor="delete-channels-toggle" className="text-sm font-medium">Eliminar canales del grupo</Label>
                <p className="text-xs text-muted-foreground">Borra todos los canales asociados a esta categoría</p>
              </div>
            </div>
            {!deleteChannels && (
              <p className="px-1 text-xs text-muted-foreground">
                Nota: si no los eliminás, los canales se conservarán y quedarán sin grupo asignado.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteChannels(false) }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteGroup.isPending}>
              {deleteGroup.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteEmptyConfirmOpen}
        onOpenChange={setDeleteEmptyConfirmOpen}
        title="Eliminar grupos vacíos"
        description={`¿Estás seguro de que deseas eliminar los ${emptyGroupsCount} grupos que no contienen ningún canal? Esta acción no afectará a tus canales existentes.`}
        confirmLabel="Eliminar grupos"
        onConfirm={handleDeleteEmpty}
        variant="destructive"
      />
    </>
  )
}
