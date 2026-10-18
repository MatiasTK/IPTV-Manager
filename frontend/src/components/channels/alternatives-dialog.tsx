import { useState } from 'react'
import { Loader2, Plus, Trash2, Crown } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { StatusLabel } from '@/components/shared/health-badge'
import { LatencyBar } from '@/components/shared/latency-bar'
import { EmptyState } from '@/components/shared/empty-state'
import { useChannel, useAddAlternative, useRemoveAlternative, useSetPrimary } from '@/hooks/use-channels'
import { useChannels } from '@/hooks/use-channels'
import type { Channel } from '@/lib/types'
import { toast } from 'sonner'
import { Separator } from '@/components/ui/separator'

interface AlternativesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel: Channel | null
}

export function AlternativesDialog({ open, onOpenChange, channel }: AlternativesDialogProps) {
  const [selectedAlt, setSelectedAlt] = useState<string>('')
  const { data: channelData, isLoading } = useChannel(open && channel ? channel.id : null)
  const { data: allChannels } = useChannels({ limit: 500 })

  const addAlt = useAddAlternative(channel?.id ?? 0)
  const removeAlt = useRemoveAlternative(channel?.id ?? 0)
  const setPrimary = useSetPrimary()

  const alternatives = channelData?.alternatives ?? []
  const altIds = new Set(alternatives.map((a) => a.id))

  const availableToAdd = allChannels?.channels.filter(
    (c) => c.id !== channel?.id && !altIds.has(c.id)
  ) ?? []

  const handleAdd = async () => {
    if (!selectedAlt || !channel) return
    try {
      await addAlt.mutateAsync(Number(selectedAlt))
      setSelectedAlt('')
      toast.success('Alternativa agregada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al agregar')
    }
  }

  const handleRemove = async (altId: number) => {
    try {
      await removeAlt.mutateAsync(altId)
      toast.success('Alternativa eliminada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    }
  }

  const handleSetPrimary = async (altId: number) => {
    if (!channel) return
    try {
      await setPrimary.mutateAsync({ altId, oldPrimaryId: channel.id })
      toast.success('Canal principal actualizado')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar principal')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Alternativas — {channel?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 aria-hidden="true" className="size-6 animate-spin text-label" />
            </div>
          ) : alternatives.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="Sin alternativas"
              description="No hay alternativas configuradas para este canal."
            />
          ) : (
            <div className="space-y-2">
              {alternatives.map((alt) => (
                <div
                  key={alt.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{alt.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <StatusLabel status={alt.health_status} />
                      <LatencyBar status={alt.health_status} ms={alt.health_latency_ms} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => handleSetPrimary(alt.id)}
                      title="Hacer principal"
                    >
                      <Crown aria-hidden="true" />
                      Principal
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(alt.id)}
                      aria-label={`Quitar alternativa ${alt.name}`}
                      className="hover:text-destructive"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Add alternative */}
          <div className="flex gap-2">
            <Select value={selectedAlt} onValueChange={setSelectedAlt}>
              <SelectTrigger aria-label="Canal alternativo" className="min-w-0 flex-1">
                <SelectValue placeholder="Seleccionar canal alternativo..." />
              </SelectTrigger>
              <SelectContent>
                {availableToAdd.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleAdd}
              disabled={!selectedAlt || addAlt.isPending}
            >
              {addAlt.isPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
