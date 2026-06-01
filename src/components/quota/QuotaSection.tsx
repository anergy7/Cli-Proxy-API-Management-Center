/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError, isDisabledAuthFile } from '@/utils/quota';
import { QuotaProgressBar } from './QuotaCard';
import type { QuotaRenderHelpers, QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);
type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;
export type QuotaEnabledFilter = 'all' | 'enabled' | 'disabled';

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  enabledFilter: QuotaEnabledFilter;
  statusUpdating?: Record<string, boolean>;
  onToggleStatus?: (file: AuthFileItem, enabled: boolean) => void;
}

const getTypeLabel = (t: TFunction, type: string): string => {
  const key = `auth_files.filter_${type}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (type.toLowerCase() === 'iflow') return 'iFlow';
  return type.charAt(0).toUpperCase() + type.slice(1);
};

const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
  enabledFilter,
  statusUpdating = {},
  onToggleStatus,
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;
  const { quota, loadQuota } = useQuotaLoader(config);
  const [sectionLoading, setSectionLoading] = useState(false);
  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const filteredFiles = useMemo(
    () =>
      files
        .filter((file) => config.filterFn(file))
        .filter((file) => {
          if (enabledFilter === 'enabled') return !isDisabledAuthFile(file);
          if (enabledFilter === 'disabled') return isDisabledAuthFile(file);
          return true;
        }),
    [files, config, enabledFilter]
  );

  const setLoading = useCallback((isLoading: boolean) => {
    setSectionLoading(isLoading);
  }, []);

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const targets = filteredFiles.filter((file) => !isDisabledAuthFile(file));
    if (targets.length === 0) return;
    loadQuota(targets, 'all', setLoading);
  }, [filteredFiles, loading, loadQuota, setLoading]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || isDisabledAuthFile(file)) return;
      if (quota[file.name]?.status === 'loading') return;

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState(),
      }));

      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>{filteredFiles.length}</span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;
  const renderQuotaCell = (file: AuthFileItem): ReactNode => {
    const state = quota[file.name];
    const quotaStatus = state?.status ?? 'idle';
    const idleMessageKey = config.cardIdleMessageKey ?? `${config.i18nPrefix}.idle`;
    const helpers: QuotaRenderHelpers = { styles, QuotaProgressBar };

    if (quotaStatus === 'loading') {
      return <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>;
    }
    if (quotaStatus === 'error') {
      return (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: resolveQuotaErrorMessage(
              t,
              state?.errorStatus,
              state?.error || t('common.unknown_error')
            ),
          })}
        </div>
      );
    }
    if (quotaStatus === 'success' && state) {
      return config.renderQuotaItems(state, t, helpers);
    }
    return <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>;
  };

  return (
    <Card
      title={titleNode}
      extra={
        <Button
          variant="secondary"
          size="sm"
          className={styles.refreshAllButton}
          onClick={handleRefresh}
          disabled={disabled || isRefreshing}
          loading={isRefreshing}
          title={t('quota_management.refresh_all_credentials')}
          aria-label={t('quota_management.refresh_all_credentials')}
        >
          {!isRefreshing && <IconRefreshCw size={16} />}
          {t('quota_management.refresh_all_credentials')}
        </Button>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <div className={styles.quotaTableWrap}>
          <table className={styles.quotaTable}>
            <thead>
              <tr>
                <th>{t('quota_management.table_provider')}</th>
                <th>{t('quota_management.table_credential')}</th>
                <th>{t('quota_management.table_enabled')}</th>
                <th>{t('quota_management.table_quota')}</th>
                <th>{t('quota_management.table_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => {
                const displayType = file.type || file.provider || config.type;
                const disabledFile = isDisabledAuthFile(file);
                return (
                  <tr key={file.name} className={disabledFile ? styles.quotaTableRowDisabled : ''}>
                    <td>
                      <span className={styles.quotaTypeBadge}>
                        {getTypeLabel(t, String(displayType))}
                      </span>
                    </td>
                    <td>
                      <div className={styles.quotaCredentialCell}>
                        <span className={styles.quotaCredentialName}>{file.name}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`${styles.quotaStatusBadge} ${
                          disabledFile ? styles.quotaStatusDisabled : styles.quotaStatusEnabled
                        }`}
                      >
                        {disabledFile
                          ? t('quota_management.filter_disabled')
                          : t('quota_management.filter_enabled')}
                      </span>
                    </td>
                    <td className={styles.quotaResultCell}>{renderQuotaCell(file)}</td>
                    <td className={styles.quotaActionsCell}>
                      {onToggleStatus && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onToggleStatus(file, disabledFile)}
                          disabled={disabled || statusUpdating[file.name] === true}
                          loading={statusUpdating[file.name] === true}
                        >
                          {disabledFile
                            ? t('auth_files.batch_enable')
                            : t('auth_files.batch_disable')}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void refreshQuotaForFile(file)}
                        disabled={
                          disabled || disabledFile || quota[file.name]?.status === 'loading'
                        }
                      >
                        {t('common.refresh')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
