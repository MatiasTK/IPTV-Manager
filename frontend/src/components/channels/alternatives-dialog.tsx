import { useState } from 'react'
import { Loader2, Plus, Trash2, Crown } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { HealthBadge, HealthDot } from '@/components/shared/health-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { useChannel, useAddAlternative, useRemoveAlternative, useSetPrimary } from '@/hooks/use-channels'
import { useChannels } from '@/hooks/use-channels'
import { formatLatency } from '@/lib/utils'
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
          <DialogTitle>Alternativas — {channel?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50"
                >
                  <HealthDot status={alt.health_status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{alt.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <HealthBadge status={alt.health_status} />
                      <span className="text-xs text-muted-foreground">
                        {formatLatency(alt.health_latency_ms)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetPrimary(alt.id)}
                      title="Hacer principal"
                      className="text-muted-foreground hover:text-primary h-8"
                    >
                      <Crown className="w-3.5 h-3.5 mr-1" />
                      Principal
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(alt.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
              <SelectTrigger className="flex-1">
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
              size="sm"
            >
              {addAlt.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
