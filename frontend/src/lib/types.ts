// ─── Auth ────────────────────────────────────────────────────────────────────
export interface User {
  id: number
  username: string
}

// ─── Groups ──────────────────────────────────────────────────────────────────
export interface Group {
  id: number
  name: string
  sort_order: number
  channel_count: number
  created_at: string
}

// ─── Sources ─────────────────────────────────────────────────────────────────
export interface Source {
  id: number
  name: string
  url: string
  type: 'url' | 'manual'
  last_synced_at: string | null
  auto_sync: number
  sync_interval_hours: number
  channel_count: number
  priority: number
  auto_priority: number
  created_at: string
}

// ─── Channels ────────────────────────────────────────────────────────────────
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'intermittent'

export interface Channel {
  id: number
  name: string
  url: string
  tvg_id: string
  tvg_name: string
  tvg_logo: string
  group_id: number | null
  group_name: string | null
  source_id: number | null
  source_name: string | null
  sort_order: number
  catchup: string
  catchup_source: string
  catchup_days: number
  http_user_agent: string
  referrer: string
  is_active: number
  health_status: HealthStatus
  health_latency_ms: number
  last_health_check: string | null
  alt_count: number
  created_at: string
  updated_at: string
}

export interface ChannelAlternative {
  id: number
  name: string
  url: string
  health_status: HealthStatus
  health_latency_ms: number
  priority: number
}

export interface ChannelWithAlternatives extends Channel {
  alternatives: ChannelAlternative[]
}

export interface ChannelFilters {
  search?: string
  groupId?: number | ''
  sourceId?: number | ''
  health?: HealthStatus | ''
  limit?: number
  page?: number
}

// ─── Health ──────────────────────────────────────────────────────────────────
export interface HealthSummary {
  healthy: number
  degraded: number
  intermittent: number
  down: number
  unknown: number
  total: number
}

export interface AutoSwitchEntry {
  timestamp: string
  channelId: number
  channelName: string
  fromUrl: string
  toUrl: string
  alternativeId: number
  reason: string
}

export interface HealthStatusResponse {
  summary: HealthSummary
  autoSwitchLog: AutoSwitchEntry[]
  isChecking: boolean
}

export interface HealthChannel {
  id: number
  name: string
  url: string
  health_status: HealthStatus
  health_latency_ms: number
  last_health_check: string | null
  group_name: string | null
  alt_count: number
}

// ─── Duplicates ──────────────────────────────────────────────────────────────
export interface DuplicateChannel {
  id: number
  name: string
  health_status: HealthStatus
}

export interface DuplicateGroup {
  channels: DuplicateChannel[]
  reason: 'url' | 'name'
  score: number
  suggestedPrimaryId: number
}

export interface DuplicatesResponse {
  groups: DuplicateGroup[]
  count: number
}

// ─── Settings ────────────────────────────────────────────────────────────────
export interface Settings {
  playlist_token: string
  epg_urls: string
  playlist_name: string
  health_check_enabled: string
  duplicate_threshold: string
}
