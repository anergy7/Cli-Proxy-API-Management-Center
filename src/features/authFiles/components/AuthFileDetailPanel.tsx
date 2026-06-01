import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconChartLine, IconInfo, IconTimer } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import { parseTimestampMs } from '@/utils/timestamp';
import { useInterval } from '@/hooks/useInterval';
import {
  formatCompactNumber,
  formatDuration,
  getLastError,
  getQuota,
  getQuotaRecoverMs,
  getRateLimit,
  getUsageLimitUntilMs,
  getWarnings,
  hasRateLimitData,
} from '@/features/authFiles/health';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import type { QuotaProviderType } from '@/features/authFiles/constants';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileDetailPanelProps = {
  file: AuthFileItem;
  quotaType?: QuotaProviderType | null;
  disableControls?: boolean;
};

type RateMetric = {
  key: string;
  label: string;
  current?: number;
  limit?: number;
  compact?: boolean;
};

const formatClockTime = (ms: number): string => {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

function RateUsageRow({ metric }: { metric: RateMetric }) {
  const { t } = useTranslation();
  const current = typeof metric.current === 'number' ? metric.current : 0;
  const hasLimit = typeof metric.limit === 'number' && metric.limit > 0;
  const percent = hasLimit
    ? Math.min(100, Math.round((current / (metric.limit as number)) * 100))
    : null;
  const fillClass =
    percent === null
      ? styles.rateBarFillOk
      : percent >= 90
        ? styles.rateBarFillCrit
        : percent >= 70
          ? styles.rateBarFillWarn
          : styles.rateBarFillOk;
  const fmt = metric.compact ? formatCompactNumber : (value: number) => String(Math.round(value));

  return (
    <div className={styles.rateMetric}>
      <span className={styles.rateMetricLabel}>{metric.label}</span>
      <div className={styles.rateMetricBody}>
        <span className={styles.rateMetricValue}>
          {fmt(current)}
          <span className={styles.rateMetricLimit}>
            {' / '}
            {hasLimit ? fmt(metric.limit as number) : t('auth_files.rate_unlimited')}
          </span>
        </span>
        {hasLimit && (
          <div className={styles.rateBar}>
            <div
              className={`${styles.rateBarFill} ${fillClass}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function AuthFileDetailPanel({
  file,
  quotaType = null,
  disableControls = false,
}: AuthFileDetailPanelProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  // Keep recovery countdowns ticking while the panel is open.
  useInterval(() => setNow(Date.now()), 1000);

  const lastError = getLastError(file);
  const quota = getQuota(file);
  const recoverMs = getQuotaRecoverMs(quota);
  const usageUntilMs = getUsageLimitUntilMs(file);
  const rateLimit = getRateLimit(file);
  const warnings = getWarnings(file);

  const showQuota = Boolean(quota && (quota.exceeded || quota.reason || recoverMs !== undefined));
  const showUsage = usageUntilMs !== undefined;
  const showRate = hasRateLimitData(rateLimit);
  const showCachedQuota = Boolean(quotaType);
  const hasAnySection =
    Boolean(lastError) ||
    showQuota ||
    showUsage ||
    showRate ||
    showCachedQuota ||
    warnings.length > 0;

  const rateMetrics: RateMetric[] = rateLimit
    ? [
        {
          key: 'rpm',
          label: t('auth_files.rate_rpm'),
          current: rateLimit.rpm_current,
          limit: rateLimit.rpm_limit,
        },
        {
          key: 'tpm',
          label: t('auth_files.rate_tpm'),
          current: rateLimit.tpm_current,
          limit: rateLimit.tpm_limit,
          compact: true,
        },
        {
          key: 'rpm30m',
          label: t('auth_files.rate_rpm_30m'),
          current: rateLimit.rpm_30m_current,
          limit: rateLimit.rpm_30m_limit,
        },
        {
          key: 'rpm10m',
          label: t('auth_files.rate_rpm_10m'),
          current: rateLimit.rpm_10m_current,
          limit: rateLimit.rpm_10m_limit,
        },
        {
          key: 'rph',
          label: t('auth_files.rate_rph'),
          current: rateLimit.rph_current,
          limit: rateLimit.rph_limit,
        },
        {
          key: 'hourly',
          label: t('auth_files.rate_hourly'),
          current: rateLimit.hourly_current,
          limit: rateLimit.hourly_limit,
        },
        {
          key: 'concurrency',
          label: t('auth_files.rate_concurrency'),
          current: rateLimit.in_flight,
          limit: rateLimit.concurrency_limit,
        },
      ].filter(
        (metric) =>
          (typeof metric.limit === 'number' && metric.limit > 0) ||
          (typeof metric.current === 'number' && metric.current > 0)
      )
    : [];

  if (!hasAnySection) {
    return <div className={styles.detailEmpty}>{t('auth_files.detail_none')}</div>;
  }

  return (
    <div className={styles.detailPanel}>
      {lastError && (
        <section className={`${styles.detailSection} ${styles.detailSectionDanger}`}>
          <h4 className={styles.detailHeading}>
            <IconAlertTriangle size={15} />
            {t('auth_files.detail_last_error')}
          </h4>
          <div className={styles.detailBody}>
            <div className={styles.detailTags}>
              {lastError.http_status !== undefined && (
                <span className={styles.detailTag}>HTTP {lastError.http_status}</span>
              )}
              {lastError.code && <span className={styles.detailTag}>{lastError.code}</span>}
              <span className={styles.detailTag}>
                {lastError.retryable
                  ? t('auth_files.detail_retryable')
                  : t('auth_files.detail_not_retryable')}
              </span>
            </div>
            {lastError.message && <p className={styles.detailMessage}>{lastError.message}</p>}
          </div>
        </section>
      )}

      {showQuota && quota && (
        <section className={`${styles.detailSection} ${styles.detailSectionDanger}`}>
          <h4 className={styles.detailHeading}>
            <IconTimer size={15} />
            {t('auth_files.detail_quota')}
          </h4>
          <div className={styles.detailBody}>
            <div className={styles.detailTags}>
              {quota.exceeded && (
                <span className={styles.detailTag}>{t('auth_files.health_status_quota')}</span>
              )}
              {typeof quota.backoff_level === 'number' && quota.backoff_level > 0 && (
                <span className={styles.detailTag}>
                  {t('auth_files.detail_backoff', { level: quota.backoff_level })}
                </span>
              )}
              {recoverMs !== undefined && (
                <span className={styles.detailTag}>
                  {recoverMs > now
                    ? t('auth_files.detail_recover_in', { time: formatDuration(recoverMs - now) })
                    : t('auth_files.detail_recovered')}
                </span>
              )}
            </div>
            {quota.reason && <p className={styles.detailMessage}>{quota.reason}</p>}
          </div>
        </section>
      )}

      {showUsage && usageUntilMs !== undefined && (
        <section className={`${styles.detailSection} ${styles.detailSectionWarn}`}>
          <h4 className={styles.detailHeading}>
            <IconTimer size={15} />
            {t('auth_files.detail_usage_limit')}
          </h4>
          <div className={styles.detailBody}>
            <div className={styles.detailTags}>
              <span className={styles.detailTag}>
                {usageUntilMs > now
                  ? t('auth_files.detail_recover_in', { time: formatDuration(usageUntilMs - now) })
                  : t('auth_files.detail_recovered')}
              </span>
            </div>
            <p className={styles.detailMessage}>{formatClockTime(usageUntilMs)}</p>
          </div>
        </section>
      )}

      {showRate && rateMetrics.length > 0 && (
        <section className={styles.detailSection}>
          <h4 className={styles.detailHeading}>
            <IconChartLine size={15} />
            {t('auth_files.detail_rate_limit')}
          </h4>
          <div className={styles.rateGrid}>
            {rateMetrics.map((metric) => (
              <RateUsageRow key={metric.key} metric={metric} />
            ))}
          </div>
        </section>
      )}

      {showCachedQuota && quotaType && (
        <section className={styles.detailSection}>
          <h4 className={styles.detailHeading}>
            <IconChartLine size={15} />
            {t('auth_files.detail_cached_quota')}
          </h4>
          <AuthFileQuotaSection
            file={file}
            quotaType={quotaType}
            disableControls={disableControls}
          />
        </section>
      )}

      {warnings.length > 0 && (
        <section className={styles.detailSection}>
          <h4 className={styles.detailHeading}>
            <IconInfo size={15} />
            {t('auth_files.detail_warnings', { count: warnings.length })}
          </h4>
          <ul className={styles.warningList}>
            {warnings.map((warning, index) => {
              const lastAtMs = warning.last_at ? parseTimestampMs(warning.last_at) : Number.NaN;
              return (
                <li key={`${warning.kind ?? 'warn'}-${index}`} className={styles.warningItem}>
                  <div className={styles.warningHead}>
                    {warning.kind && <span className={styles.warningKind}>{warning.kind}</span>}
                    {warning.http_status ? (
                      <span className={styles.warningMeta}>HTTP {warning.http_status}</span>
                    ) : null}
                    {warning.count && warning.count > 1 ? (
                      <span className={styles.warningMeta}>×{warning.count}</span>
                    ) : null}
                    {Number.isFinite(lastAtMs) && (
                      <span className={styles.warningTime}>{formatClockTime(lastAtMs)}</span>
                    )}
                  </div>
                  {warning.message && <p className={styles.warningMessage}>{warning.message}</p>}
                  {warning.model && <span className={styles.warningModel}>{warning.model}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
