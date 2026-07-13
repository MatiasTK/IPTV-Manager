import { useState, useEffect } from 'react'
import { FolderOpen, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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

  // Auto-suggest states
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [selectedSuggestGroups, setSelectedSuggestGroups] = useState<Record<string, boolean>>({})

  const { data: suggestData, isLoading: suggestLoading } = useAutoSuggestGroups(suggestOpen)
  const applySuggest = useApplyAutoSuggest()

  const groups = data?.groups ?? []
  const emptyGroupsCount = groups.filter((g) => g.channel_count === 0).length

  useEffect(() => {
    if (suggestData?.suggestions) {
      const initial: Record<string, boolean> = {}
      suggestData.suggestions.forEach((s) => {
        initial[s.groupName] = true
      })
      setSelectedSuggestGroups(initial)
    }
  }, [suggestData])

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

  return (
    <div>
      <PageHeader
        title="Grupos"
        subtitle="Organización de canales por categorías"
        icon={FolderOpen}
        actions={
          <div className="flex gap-2">
            {emptyGroupsCount > 0 && (
              <Button
                variant="destructive"
                onClick={() => setDeleteEmptyConfirmOpen(true)}
                disabled={deleteEmptyGroups.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar vacíos ({emptyGroupsCount})
              </Button>
            )}
            <Button variant="outline" onClick={() => setSuggestOpen(true)}>
              <Sparkles className="w-4 h-4 mr-2" />
              Autogrupar canales
            </Button>
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Crear grupo
            </Button>
          </div>
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

      {/* Delete group dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteChannels(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar grupo</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que deseas eliminar el grupo "{deleteTarget?.name}"?
            </p>
            
            <div className="flex items-center space-x-3 bg-muted/50 p-3 rounded-lg border border-border">
              <Switch id="delete-channels-toggle" checked={deleteChannels} onCheckedChange={setDeleteChannels} />
              <div className="space-y-0.5">
                <Label htmlFor="delete-channels-toggle" className="text-sm font-medium cursor-pointer">
                  Eliminar canales del grupo
                </Label>
                <p className="text-xs text-muted-foreground">Borra todos los canales asociados a esta categoría</p>
              </div>
            </div>
            {!deleteChannels && (
              <p className="text-xs text-muted-foreground px-1">
                Nota: Si no los eliminas, los canales se conservarán y quedarán sin grupo asignado.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteChannels(false) }}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteGroup.isPending}>
              {deleteGroup.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto Suggest Dialog */}
      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sugerencias de Agrupamiento Automático</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Hemos analizado tus canales sin grupo y te sugerimos las siguientes categorías según sus nombres.
            </p>

            {suggestLoading ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-2">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Analizando canales...</span>
              </div>
            ) : !suggestData?.suggestions || suggestData.suggestions.length === 0 ? (
              <div className="text-center py-6">
                <span className="text-sm text-muted-foreground">No se encontraron canales sin grupo para agrupar automáticamente.</span>
              </div>
            ) : (
              <div className="space-y-4">
                {suggestData.suggestions.map((s) => {
                  const isChecked = !!selectedSuggestGroups[s.groupName]
                  return (
                    <div key={s.groupName} className="border border-border rounded-lg p-3 bg-muted/20 space-y-2">
                      <div className="flex items-center justify-between border-b border-border/50 pb-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`group-chk-${s.groupName}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              setSelectedSuggestGroups((prev) => ({
                                ...prev,
                                [s.groupName]: checked === true,
                              }))
                            }}
                          />
                          <Label htmlFor={`group-chk-${s.groupName}`} className="font-semibold text-sm cursor-pointer ml-1.5">
                            {s.groupName}
                          </Label>
                        </div>
                        <Badge variant="secondary">{s.channels.length} {s.channels.length === 1 ? 'canal' : 'canales'}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {s.channels.map((ch) => (
                          <Badge key={ch.id} variant="outline" className="text-xs font-normal">
                            {ch.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                suggestLoading ||
                !suggestData?.suggestions ||
                suggestData.suggestions.length === 0 ||
                applySuggest.isPending ||
                !Object.values(selectedSuggestGroups).some(Boolean)
              }
              onClick={async () => {
                if (!suggestData?.suggestions) return
                const payload = suggestData.suggestions
                  .filter((s) => selectedSuggestGroups[s.groupName])
                  .map((s) => ({
                    groupName: s.groupName,
                    channelIds: s.channels.map((ch) => ch.id),
                  }))

                try {
                  await applySuggest.mutateAsync(payload)
                  toast.success('Agrupamientos aplicados correctamente')
                  setSuggestOpen(false)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Error al aplicar agrupamiento')
                }
              }}
            >
              {applySuggest.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Aplicar {Object.values(selectedSuggestGroups).filter(Boolean).length} grupos
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
    </div>
  )
}
