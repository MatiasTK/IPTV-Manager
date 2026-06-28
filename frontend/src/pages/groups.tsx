import { useState } from 'react'
import { FolderOpen, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup, useReorderGroups } from '@/hooks/use-groups'
import type { Group } from '@/lib/types'
import { toast } from 'sonner'

export default function GroupsPage() {
  const { data, isLoading } = useGroups()
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const deleteGroup = useDeleteGroup()
  const reorderGroups = useReorderGroups()

  const [formOpen, setFormOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<Group | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)
  const [name, setName] = useState('')

  const groups = data?.groups ?? []

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
      await deleteGroup.mutateAsync(deleteTarget.id)
      toast.success('Grupo eliminado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeleteTarget(null)
    }
  }

  const handleReorder = async (fromIdx: number, direction: 'up' | 'down') => {
    const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1
    if (toIdx < 0 || toIdx >= groups.length) return

    const reordered = [...groups]
    const a = reordered[fromIdx]
    const b = reordered[toIdx]

    const order = [
      { id: a.id, sort_order: b.sort_order },
      { id: b.id, sort_order: a.sort_order },
    ]

    try {
      await reorderGroups.mutateAsync(order)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al reordenar')
    }
  }

  return (
    <div>
      <PageHeader
        title="Grupos"
        subtitle="Organización de canales por categorías"
        icon={FolderOpen}
        actions={
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Crear grupo
          </Button>
        }
      />

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead>Grupo</TableHead>
              <TableHead className="w-24">Canales</TableHead>
              <TableHead className="w-24">Orden</TableHead>
              <TableHead className="w-32">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <EmptyState
                    icon={FolderOpen}
                    title="No hay grupos"
                    description="Los grupos se crean automáticamente al importar listas."
                    action={{ label: 'Crear grupo', onClick: handleOpenCreate }}
                  />
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group, idx) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{group.channel_count}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-mono">
                    #{group.sort_order}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={idx === 0}
                        onClick={() => handleReorder(idx, 'up')}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={idx === groups.length - 1}
                        onClick={() => handleReorder(idx, 'down')}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenEdit(group)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(group)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Form dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editGroup ? 'Editar grupo' : 'Nuevo grupo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="group-name">Nombre del grupo</Label>
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
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || createGroup.isPending || updateGroup.isPending}
            >
              {(createGroup.isPending || updateGroup.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {editGroup ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Eliminar grupo"
        description={`Los canales de "${deleteTarget?.name}" quedarán sin grupo. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
    </div>
  )
}
