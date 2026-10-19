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
export interface SourceVerification {
  type: 'url' | 'xtream'
  ok: boolean
  problem?: string | null
  latencyMs?: number
  httpStatus?: number
  /** Xtream account status, e.g. "Active", "Expired", "Banned". */
  status?: string
  /** null = no expiry. */
  expiresAt?: string | null
  isTrial?: boolean
  /** Simultaneous streams the account allows. */
  maxConnections?: number
  /** Streams being watched right now with this account. */
  activeConnections?: number
  checkedAt: string
}

export interface Source {
  id: number
  name: string
  url: string
  type: 'url' | 'manual' | 'xtream'
  last_synced_at: string | null
  auto_sync: number
  sync_interval_hours: number
  channel_count: number
  priority: number
  auto_priority: number
  xtream_host: string
  xtream_user: string
  xtream_pass: string
  /** Group names the sync never imports for this source. */
  excluded_groups: string[]
  /** Result of the last "Verificar fuente" run, null if never verified. */
  verify_info: SourceVerification | null
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
  groupId?: number | '' | 'none'
  sourceId?: number | ''
  health?: HealthStatus | ''
  limit?: number
  page?: number
  sortBy?: 'name' | 'group' | 'source' | 'status' | 'latency'
  sortOrder?: 'asc' | 'desc'
}

// ─── Source Preview ────────────────────────────────────────────────────────────────
export interface PreviewChannel {
  name: string
  url: string
  groupTitle: string
  tvgLogo: string
  isDuplicate: boolean          // already exists in DB (exact URL match)
  isInternalDuplicate: boolean  // repeated within this same source list
}

export interface SourcePreviewResponse {
  channels: PreviewChannel[]
  groups: string[]
  total: number
  dbDuplicateCount: number
  internalDuplicateCount: number
}

export type PreviewContext =
  | { type: 'url';    name: string; url: string; autoSync: number; syncIntervalHours: number; priority: number; autoPriority: number }
  | { type: 'text';   name: string; text: string }
  | { type: 'xtream'; name: string; xtreamHost: string; xtreamUser: string; xtreamPass: string; autoSync: number; syncIntervalHours: number; priority: number; autoPriority: number }

export interface ImportResult {
  ok: boolean
  sourceId: number
  imported: number
  updated: number
  skipped: number
  total: number
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
  fromSource: string | null
  toSource: string | null
  reason: string
}

export interface HealthSourceSummary {
  id: number
  name: string
  total: number
  down: number
}

export interface HealthStatusResponse {
  summary: HealthSummary
  sources: HealthSourceSummary[]
  autoSwitchLog: AutoSwitchEntry[]
  isChecking: boolean
  progress: { checked: number; total: number }
  checkingSourceId: number | null
  lastCheckAt: string | null
  nextCheckAt: string | null
  intervalMinutes: number
}

export interface HealthChannel {
  id: number
  name: string
  url: string
  health_status: HealthStatus
  health_latency_ms: number
  last_health_check: string | null
  group_name: string | null
  source_id: number | null
  source_name: string | null
  alt_count: number
}

// ─── Duplicates ──────────────────────────────────────────────────────────────
export interface DuplicateChannel {
  id: number
  name: string
  health_status: HealthStatus
  health_latency_ms: number
  source_name: string | null
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
  offset: number
  limit: number
}

// ─── Settings ────────────────────────────────────────────────────────────────
export interface Settings {
  playlist_token: string
  epg_urls: string
  playlist_name: string
  health_check_enabled: string
  health_check_interval_minutes?: string
  duplicate_threshold: string
  publish_auto?: string
}

export interface PublishSlot {
  slot: number
  sourceId: number | null
  sourceName: string | null
  sourceType: 'url' | 'manual' | 'xtream' | null
  assignedAt: string | null
  publishedAt: string | null
  channelCount: number
  deadExcluded: number
  lastError: string | null
  pending: boolean
  warnings: string[]
  url: string | null
}

export interface PublishSlotsResponse {
  gistId: string | null
  auto: boolean
  publishing: boolean
  slots: PublishSlot[]
}

export interface PublishPreview {
  pending: boolean
  channelCount: number
  deadExcluded: number
  previousChannelCount: number
  sample: string
}
