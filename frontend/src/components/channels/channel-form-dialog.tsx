import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useCreateChannel, useUpdateChannel } from '@/hooks/use-channels'
import { useGroups } from '@/hooks/use-groups'
import type { Channel } from '@/lib/types'
import { toast } from 'sonner'

interface ChannelFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel?: Channel | null
}

interface FormData {
  name: string
  url: string
  tvgId: string
  tvgName: string
  tvgLogo: string
  groupId: string
  catchup: string
  catchupSource: string
  catchupDays: string
  httpUserAgent: string
  referrer: string
}

export function ChannelFormDialog({ open, onOpenChange, channel }: ChannelFormDialogProps) {
  const { data: groupsData } = useGroups()
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const isEditing = !!channel

  const { register, handleSubmit, reset, setValue, watch, formState: { isSubmitting } } = useForm<FormData>({
    defaultValues: {
      name: channel?.name ?? '',
      url: channel?.url ?? '',
      tvgId: channel?.tvg_id ?? '',
      tvgName: channel?.tvg_name ?? '',
      tvgLogo: channel?.tvg_logo ?? '',
      groupId: channel?.group_id ? String(channel.group_id) : '',
      catchup: channel?.catchup ?? '',
      catchupSource: channel?.catchup_source ?? '',
      catchupDays: channel?.catchup_days ? String(channel.catchup_days) : '',
      httpUserAgent: channel?.http_user_agent ?? '',
      referrer: channel?.referrer ?? '',
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        name: channel?.name ?? '',
        url: channel?.url ?? '',
        tvgId: channel?.tvg_id ?? '',
        tvgName: channel?.tvg_name ?? '',
        tvgLogo: channel?.tvg_logo ?? '',
        groupId: channel?.group_id ? String(channel.group_id) : '',
        catchup: channel?.catchup ?? '',
        catchupSource: channel?.catchup_source ?? '',
        catchupDays: channel?.catchup_days ? String(channel.catchup_days) : '',
        httpUserAgent: channel?.http_user_agent ?? '',
        referrer: channel?.referrer ?? '',
      })
    } else {
      reset({
        name: '',
        url: '',
        tvgId: '',
        tvgName: '',
        tvgLogo: '',
        groupId: '',
        catchup: '',
        catchupSource: '',
        catchupDays: '',
        httpUserAgent: '',
        referrer: '',
      })
    }
  }, [channel, open, reset])

  const groupIdValue = watch('groupId')

  const onSubmit = async (data: FormData) => {
    const payload = {
      name: data.name,
      url: data.url,
      tvgId: data.tvgId || undefined,
      tvgName: data.tvgName || undefined,
      tvgLogo: data.tvgLogo || undefined,
      groupId: data.groupId ? Number(data.groupId) : null,
      catchup: data.catchup || undefined,
      catchupSource: data.catchupSource || undefined,
      catchupDays: data.catchupDays ? Number(data.catchupDays) : undefined,
      httpUserAgent: data.httpUserAgent || undefined,
      referrer: data.referrer || undefined,
    }

    try {
      if (isEditing && channel) {
        await updateChannel.mutateAsync({ id: channel.id, ...payload })
        toast.success('Canal actualizado')
      } else {
        await createChannel.mutateAsync(payload)
        toast.success('Canal creado')
      }
      onOpenChange(false)
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar canal' : 'Nuevo canal'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Name - full width */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ch-name">Nombre *</Label>
              <Input id="ch-name" {...register('name', { required: true })} placeholder="Ej: CNN International" />
            </div>

            {/* URL - full width */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ch-url">URL del Stream *</Label>
              <Input id="ch-url" {...register('url', { required: true })} placeholder="https://..." className="font-mono text-sm" />
            </div>

            {/* TVG ID */}
            <div className="space-y-1.5">
              <Label htmlFor="ch-tvgid">TVG ID (EPG)</Label>
              <Input id="ch-tvgid" {...register('tvgId')} placeholder="CNN" />
            </div>

            {/* TVG Name */}
            <div className="space-y-1.5">
              <Label htmlFor="ch-tvgname">TVG Name</Label>
              <Input id="ch-tvgname" {...register('tvgName')} placeholder="CNN International" />
            </div>

            {/* Logo URL - full width */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ch-logo">Logo URL</Label>
              <Input id="ch-logo" {...register('tvgLogo')} placeholder="https://..." />
            </div>

            {/* Group */}
            <div className="space-y-1.5">
              <Label>Grupo</Label>
              <Select value={groupIdValue} onValueChange={(v) => setValue('groupId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin grupo</SelectItem>
                  {groupsData?.groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Catchup type */}
            <div className="space-y-1.5">
              <Label htmlFor="ch-catchup">Catch-up Type</Label>
              <Input id="ch-catchup" {...register('catchup')} placeholder="default" />
            </div>

            {/* Catchup source - full width */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ch-catchupsrc">Catch-up Source</Label>
              <Input id="ch-catchupsrc" {...register('catchupSource')} />
            </div>

            {/* Catchup days */}
            <div className="space-y-1.5">
              <Label htmlFor="ch-catchupdays">Catch-up Days</Label>
              <Input id="ch-catchupdays" type="number" {...register('catchupDays')} min="0" />
            </div>

            {/* User Agent */}
            <div className="space-y-1.5">
              <Label htmlFor="ch-ua">User Agent</Label>
              <Input id="ch-ua" {...register('httpUserAgent')} />
            </div>

            {/* Referrer */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ch-referrer">Referrer</Label>
              <Input id="ch-referrer" {...register('referrer')} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEditing ? 'Guardar cambios' : 'Crear canal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
