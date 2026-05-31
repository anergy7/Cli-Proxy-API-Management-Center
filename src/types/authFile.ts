/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

/** Last upstream failure recorded for a credential (per-account-rate-limit branch). */
export interface AuthFileLastError {
  code?: string;
  message?: string;
  retryable?: boolean;
  http_status?: number;
}

/** Quota / cooldown state surfaced by the backend. */
export interface AuthFileQuota {
  exceeded?: boolean;
  backoff_level?: number;
  reason?: string;
  next_recover_at?: string;
}

/** Effective per-account rate-limit window (limits + current usage). */
export interface AuthFileRateLimit {
  rpm_limit?: number;
  tpm_limit?: number;
  concurrency_limit?: number;
  rph_limit?: number;
  hourly_limit?: number;
  rpm_30m_limit?: number;
  rpm_current?: number;
  tpm_current?: number;
  rph_current?: number;
  hourly_current?: number;
  rpm_30m_current?: number;
  in_flight?: number;
}

/** A single recent warning observed for a credential. */
export interface AuthFileWarning {
  kind?: string;
  code?: string;
  message?: string;
  http_status?: number;
  model?: string;
  count?: number;
  first_at?: string;
  last_at?: string;
}

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  numberId?: string | number | null;
  number_id?: string | number | null;
  authIndex?: string | number | null;
  auth_index?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  status_message?: string;
  createdAt?: string | number;
  lastRefresh?: string | number;
  modified?: number;
  priority?: number | string;
  note?: string;
  success?: unknown;
  failed?: unknown;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  // Per-account rate-limit / quota diagnostics (feat/per-account-rate-limit).
  last_error?: AuthFileLastError;
  quota?: AuthFileQuota;
  rate_limit?: AuthFileRateLimit;
  usage_limit_until?: string;
  warning_count?: number;
  warnings?: AuthFileWarning[];
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
