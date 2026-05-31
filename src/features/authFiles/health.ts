import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  AuthFileLastError,
  AuthFileQuota,
  AuthFileRateLimit,
  AuthFileWarning,
} from '@/types';
import { parseTimestampMs } from '@/utils/timestamp';
import { getAuthFileStatusMessage, isRuntimeOnlyAuthFile } from './constants';

// Status messages that mean "all good" rather than an actual warning.
const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);
// HTTP statuses that indicate a credential-level (non-transient) failure.
const CREDENTIAL_ERROR_STATUSES = new Set([401, 403]);

export type HealthLevel =
  | 'virtual'
  | 'disabled'
  | 'error'
  | 'quota_exceeded'
  | 'usage_limited'
  | 'rate_limited'
  | 'warning'
  | 'healthy';

export type HealthTone = 'neutral' | 'good' | 'warning' | 'danger';

export interface AuthFileHealth {
  level: HealthLevel;
  tone: HealthTone;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export function getLastError(file: AuthFileItem): AuthFileLastError | null {
  const raw = asRecord(file.last_error ?? file['lastError']);
  if (!raw) return null;
  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const httpStatus = asFiniteNumber(raw.http_status ?? raw['httpStatus']);
  if (!message && !code && httpStatus === undefined) return null;
  return {
    code: code || undefined,
    message: message || undefined,
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : undefined,
    http_status: httpStatus,
  };
}

export function getQuota(file: AuthFileItem): AuthFileQuota | null {
  const raw = asRecord(file.quota);
  if (!raw) return null;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const nextRecover = typeof raw.next_recover_at === 'string' ? raw.next_recover_at : undefined;
  return {
    exceeded: raw.exceeded === true,
    backoff_level: asFiniteNumber(raw.backoff_level),
    reason: reason || undefined,
    next_recover_at: nextRecover,
  };
}

export function getRateLimit(file: AuthFileItem): AuthFileRateLimit | null {
  const raw = asRecord(file.rate_limit);
  if (!raw) return null;
  return {
    rpm_limit: asFiniteNumber(raw.rpm_limit),
    tpm_limit: asFiniteNumber(raw.tpm_limit),
    concurrency_limit: asFiniteNumber(raw.concurrency_limit),
    rph_limit: asFiniteNumber(raw.rph_limit),
    rpm_30m_limit: asFiniteNumber(raw.rpm_30m_limit),
    rpm_current: asFiniteNumber(raw.rpm_current),
    tpm_current: asFiniteNumber(raw.tpm_current),
    rph_current: asFiniteNumber(raw.rph_current),
    rpm_30m_current: asFiniteNumber(raw.rpm_30m_current),
    in_flight: asFiniteNumber(raw.in_flight),
  };
}

export function getWarnings(file: AuthFileItem): AuthFileWarning[] {
  const raw = file.warnings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is AuthFileWarning => Boolean(asRecord(entry)));
}

export function getWarningCount(file: AuthFileItem): number {
  const total = asFiniteNumber(file.warning_count);
  if (total !== undefined) return Math.max(0, Math.trunc(total));
  return getWarnings(file).length;
}

export function getUsageLimitUntilMs(file: AuthFileItem): number | undefined {
  const raw = file.usage_limit_until;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const ms = parseTimestampMs(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

export function getQuotaRecoverMs(quota: AuthFileQuota | null): number | undefined {
  if (!quota?.next_recover_at) return undefined;
  const ms = parseTimestampMs(quota.next_recover_at);
  return Number.isFinite(ms) ? ms : undefined;
}

const overLimit = (current?: number, limit?: number): boolean =>
  typeof limit === 'number' && limit > 0 && typeof current === 'number' && current >= limit;

export function isRateLimited(rl: AuthFileRateLimit | null): boolean {
  if (!rl) return false;
  return (
    overLimit(rl.rpm_current, rl.rpm_limit) ||
    overLimit(rl.tpm_current, rl.tpm_limit) ||
    overLimit(rl.rph_current, rl.rph_limit) ||
    overLimit(rl.rpm_30m_current, rl.rpm_30m_limit) ||
    overLimit(rl.in_flight, rl.concurrency_limit)
  );
}

export function hasRateLimitData(rl: AuthFileRateLimit | null): boolean {
  if (!rl) return false;
  return [
    rl.rpm_limit,
    rl.tpm_limit,
    rl.concurrency_limit,
    rl.rph_limit,
    rl.rpm_30m_limit,
    rl.rpm_current,
    rl.tpm_current,
    rl.rph_current,
    rl.rpm_30m_current,
    rl.in_flight,
  ].some((value) => typeof value === 'number' && value > 0);
}

export function hasStatusWarning(file: AuthFileItem): boolean {
  const message = getAuthFileStatusMessage(file);
  return Boolean(message) && !HEALTHY_STATUS_MESSAGES.has(message.toLowerCase());
}

/**
 * Classify an auth file into a single health level (most severe wins) plus a
 * color tone used by the table state badge.
 */
export function classifyAuthFileHealth(file: AuthFileItem, nowMs: number): AuthFileHealth {
  if (isRuntimeOnlyAuthFile(file)) return { level: 'virtual', tone: 'neutral' };
  if (file.disabled) return { level: 'disabled', tone: 'neutral' };

  const lastError = getLastError(file);
  const isCredentialError =
    lastError !== null &&
    (lastError.retryable === false ||
      (lastError.http_status !== undefined &&
        CREDENTIAL_ERROR_STATUSES.has(lastError.http_status)));
  if (isCredentialError || file.unavailable === true) {
    return { level: 'error', tone: 'danger' };
  }

  const quota = getQuota(file);
  const recoverMs = getQuotaRecoverMs(quota);
  if (quota?.exceeded || (recoverMs !== undefined && recoverMs > nowMs)) {
    return { level: 'quota_exceeded', tone: 'danger' };
  }

  const usageUntilMs = getUsageLimitUntilMs(file);
  if (usageUntilMs !== undefined && usageUntilMs > nowMs) {
    return { level: 'usage_limited', tone: 'warning' };
  }

  if (isRateLimited(getRateLimit(file))) {
    return { level: 'rate_limited', tone: 'warning' };
  }

  if (lastError !== null || hasStatusWarning(file)) {
    return { level: 'warning', tone: 'warning' };
  }

  return { level: 'healthy', tone: 'good' };
}

export const HEALTH_LEVEL_I18N_KEY: Record<HealthLevel, string> = {
  virtual: 'auth_files.health_status_virtual',
  disabled: 'auth_files.health_status_disabled',
  error: 'auth_files.health_status_error',
  quota_exceeded: 'auth_files.health_status_quota',
  usage_limited: 'auth_files.health_status_usage',
  rate_limited: 'auth_files.health_status_rate_limited',
  warning: 'auth_files.health_status_warning',
  healthy: 'auth_files.health_status_healthy',
};

/** Format a positive millisecond duration as a short countdown, e.g. "1h 5m", "3m 12s", "8s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Short, single-line hint shown under the state badge in the table row. Avoids
 * live countdowns (the expandable detail panel owns those and ticks).
 */
export function buildHealthSummary(file: AuthFileItem, t: TFunction, nowMs: number): string {
  const { level } = classifyAuthFileHealth(file, nowMs);
  if (level === 'error') {
    const error = getLastError(file);
    if (error?.message) {
      return error.http_status ? `${error.http_status} · ${error.message}` : error.message;
    }
    if (error?.code) return error.code;
    return getAuthFileStatusMessage(file);
  }
  if (level === 'quota_exceeded') {
    const quota = getQuota(file);
    if (quota?.reason) return quota.reason;
    return t('auth_files.health_status_quota');
  }
  if (level === 'warning') {
    const error = getLastError(file);
    if (error?.message) return error.message;
    return getAuthFileStatusMessage(file);
  }
  // rate_limited / usage_limited are self-explanatory via the badge; the live
  // countdown and metric breakdown live in the expandable detail panel.
  return '';
}

/** Compactly format large counters, e.g. 12000 -> "12k", 1500000 -> "1.5M". */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}k`;
  }
  return String(Math.round(value));
}
