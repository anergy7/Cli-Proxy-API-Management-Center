import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type {
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
  XaiQuotaState,
} from '@/types';
import { getStatusFromError } from '@/utils/quota';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import styles from '@/pages/AuthFilesPage.module.scss';

type QuotaState =
  | AntigravityQuotaState
  | ClaudeQuotaState
  | CodexQuotaState
  | GeminiCliQuotaState
  | KimiQuotaState
  | XaiQuotaState
  | undefined;

type QuotaSummaryItem = {
  key: string;
  label: string;
  value: string;
};

const getQuotaConfig = (type: QuotaProviderType) => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG;
  if (type === 'claude') return CLAUDE_CONFIG;
  if (type === 'codex') return CODEX_CONFIG;
  if (type === 'kimi') return KIMI_CONFIG;
  if (type === 'xai') return XAI_CONFIG;
  return GEMINI_CLI_CONFIG;
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
  compact?: boolean;
};

const formatPercent = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
};

const formatCountPair = (current: number, limit: number): string => {
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) return '-';
  return `${Math.max(0, Math.round(current))}/${Math.round(limit)}`;
};

const labelFromQuotaItem = (
  t: TFunction,
  item: { label?: string; labelKey?: string; labelParams?: Record<string, string | number> }
): string => {
  if (item.labelKey) return t(item.labelKey, item.labelParams ?? {});
  return item.label ?? '-';
};

const summarizeQuota = (
  quotaType: QuotaProviderType,
  quota: Exclude<QuotaState, undefined>,
  t: TFunction
): QuotaSummaryItem[] => {
  if (quota.status !== 'success') return [];

  if (quotaType === 'claude') {
    const state = quota as ClaudeQuotaState;
    return state.windows.slice(0, 2).map((window) => ({
      key: window.id,
      label: labelFromQuotaItem(t, window),
      value: formatPercent(
        typeof window.usedPercent === 'number' ? 100 - window.usedPercent : null
      ),
    }));
  }

  if (quotaType === 'codex') {
    const state = quota as CodexQuotaState;
    return state.windows.slice(0, 2).map((window) => ({
      key: window.id,
      label: labelFromQuotaItem(t, window),
      value: formatPercent(
        typeof window.usedPercent === 'number' ? 100 - window.usedPercent : null
      ),
    }));
  }

  if (quotaType === 'antigravity') {
    const state = quota as AntigravityQuotaState;
    return state.groups.slice(0, 2).map((group) => ({
      key: group.id,
      label: group.label,
      value: formatPercent(group.remainingFraction * 100),
    }));
  }

  if (quotaType === 'gemini-cli') {
    const state = quota as GeminiCliQuotaState;
    return state.buckets.slice(0, 2).map((bucket) => ({
      key: bucket.id,
      label: bucket.label,
      value:
        typeof bucket.remainingAmount === 'number'
          ? String(Math.round(bucket.remainingAmount))
          : formatPercent(
              typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction * 100 : null
            ),
    }));
  }

  if (quotaType === 'kimi') {
    const state = quota as KimiQuotaState;
    return state.rows.slice(0, 2).map((row) => ({
      key: row.id,
      label: labelFromQuotaItem(t, row),
      value: formatCountPair(Math.max(0, row.limit - row.used), row.limit),
    }));
  }

  const state = quota as XaiQuotaState;
  if (!state.billing) return [];
  return [
    {
      key: 'monthly',
      label: t('xai_quota.monthly_credits'),
      value: formatPercent(
        typeof state.billing.usedPercent === 'number' ? 100 - state.billing.usedPercent : null
      ),
    },
  ];
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls, compact = false } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    if (quotaType === 'xai') return state.xaiQuota[file.name] as QuotaState;
    return state.geminiCliQuota[file.name] as QuotaState;
  });

  const updateQuotaState = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.setAntigravityQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'claude')
      return state.setClaudeQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'xai') return state.setXaiQuota as unknown as (updater: unknown) => void;
    return state.setGeminiCliQuota as unknown as (updater: unknown) => void;
  });

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;

    const config = getQuotaConfig(quotaType) as unknown as {
      i18nPrefix: string;
      fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildLoadingState: () => unknown;
      buildSuccessState: (data: unknown) => unknown;
      buildErrorState: (message: string, status?: number) => unknown;
      renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
    };

    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: config.buildLoadingState(),
    }));

    try {
      const data = await config.fetchQuota(file, t);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildSuccessState(data),
      }));
      showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildErrorState(message, status),
      }));
      showNotification(t('auth_files.quota_refresh_failed', { name: file.name, message }), 'error');
    }
  }, [disableControls, file, quota?.status, quotaType, showNotification, t, updateQuotaState]);

  const config = getQuotaConfig(quotaType) as unknown as {
    i18nPrefix: string;
    renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
  };

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  if (compact) {
    const summaryItems =
      quota && quota.status === 'success' ? summarizeQuota(quotaType, quota, t) : [];
    const statusLabel =
      quotaStatus === 'loading'
        ? t('auth_files.quota_status_loading')
        : quotaStatus === 'error'
          ? t('auth_files.quota_status_error')
          : quotaStatus === 'success'
            ? t('auth_files.quota_status_success')
            : t('auth_files.quota_status_idle');

    return (
      <div className={styles.tableQuotaCompact}>
        <div className={styles.tableQuotaHeader}>
          <span
            className={`${styles.tableQuotaBadge} ${
              quotaStatus === 'error' ? styles.tableQuotaBadgeError : ''
            }`}
            title={quotaStatus === 'error' ? quotaErrorMessage : statusLabel}
          >
            {statusLabel}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className={styles.tableQuotaRefresh}
            onClick={() => void refreshQuotaForFile()}
            disabled={!canRefreshQuota || quotaStatus === 'loading'}
            loading={quotaStatus === 'loading'}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            {quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
          </Button>
        </div>
        {quotaStatus === 'error' ? (
          <span className={styles.tableQuotaError} title={quotaErrorMessage}>
            {quotaErrorMessage}
          </span>
        ) : summaryItems.length > 0 ? (
          <div className={styles.tableQuotaItems}>
            {summaryItems.map((item) => (
              <span key={item.key} className={styles.tableQuotaItem} title={item.label}>
                {item.label}: {item.value}
              </span>
            ))}
          </div>
        ) : (
          <span className={styles.tableMuted}>-</span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${config.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota ? (
        (config.renderQuotaItems(quota, t, { styles, QuotaProgressBar }) as ReactNode)
      ) : (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>
      )}
    </div>
  );
}
