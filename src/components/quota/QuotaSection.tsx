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
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { formatCreatedCompact, getAuthFileNumberID } from '@/features/authFiles/constants';
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

const getOrderID = (file: AuthFileItem): string => {
  const raw = file.order_id ?? file.orderId ?? file['order'];
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
};

const getAccountName = (file: AuthFileItem): string => {
  const raw =
    file.email ??
    file.account ??
    file.username ??
    file.user ??
    file['account_email'] ??
    file['accountEmail'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const name = file.name.replace(/\.json$/i, '');
  return name.replace(/^[^-]+-/, '');
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
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
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

  const selectedVisibleFiles = useMemo(
    () => filteredFiles.filter((file) => selectedFiles.has(file.name)),
    [filteredFiles, selectedFiles]
  );
  const allVisibleSelected =
    filteredFiles.length > 0 && filteredFiles.every((file) => selectedFiles.has(file.name));

  useEffect(() => {
    const visibleNames = new Set(filteredFiles.map((file) => file.name));
    setSelectedFiles((prev) => {
      const next = new Set([...prev].filter((name) => visibleNames.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredFiles]);

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
    const targets = filteredFiles;
    if (targets.length === 0) return;
    loadQuota(targets, 'all', setLoading);
  }, [filteredFiles, loading, loadQuota, setLoading]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled) return;
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

  const toggleFileSelection = useCallback((name: string, checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        filteredFiles.forEach((file) => {
          if (checked) {
            next.add(file.name);
          } else {
            next.delete(file.name);
          }
        });
        return next;
      });
    },
    [filteredFiles]
  );

  const copySelectedCredentials = useCallback(async () => {
    if (selectedVisibleFiles.length === 0) return;
    const text = selectedVisibleFiles
      .map((file) => [getAccountName(file), getOrderID(file)].filter(Boolean).join('\t'))
      .join('\n');
    const copied = await copyToClipboard(text);
    showNotification(
      copied
        ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
        : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
      copied ? 'success' : 'error'
    );
  }, [selectedVisibleFiles, showNotification, t]);

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
          <div className={styles.quotaSelectionBar}>
            <SelectionCheckbox
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              ariaLabel={t('auth_files.batch_select_filtered')}
              label={t('auth_files.batch_selected', { count: selectedVisibleFiles.length })}
              disabled={filteredFiles.length === 0}
            />
            <div className={styles.quotaSelectionActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copySelectedCredentials()}
                disabled={selectedVisibleFiles.length === 0}
              >
                {t('auth_files.batch_export_copy')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFiles(new Set())}
                disabled={selectedVisibleFiles.length === 0}
              >
                {t('auth_files.batch_deselect')}
              </Button>
            </div>
          </div>
          <table className={styles.quotaTable}>
            <thead>
              <tr>
                <th>{t('quota_management.table_number')}</th>
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
                const numberID = getAuthFileNumberID(file);
                const orderID = getOrderID(file);
                const createdLabel = formatCreatedCompact(file);
                const metaItems = [
                  orderID ? t('quota_management.credential_order', { order: orderID }) : '',
                  createdLabel !== '-'
                    ? t('quota_management.credential_created', { time: createdLabel })
                    : '',
                ].filter(Boolean);
                return (
                  <tr key={file.name} className={disabledFile ? styles.quotaTableRowDisabled : ''}>
                    <td className={styles.quotaNumberCell}>
                      <SelectionCheckbox
                        checked={selectedFiles.has(file.name)}
                        onChange={(checked) => toggleFileSelection(file.name, checked)}
                        ariaLabel={t('auth_files.batch_select_one', { name: file.name })}
                        label={
                          numberID ? t('quota_management.credential_number', { id: numberID }) : '-'
                        }
                      />
                    </td>
                    <td>
                      <span className={styles.quotaTypeBadge}>
                        {getTypeLabel(t, String(displayType))}
                      </span>
                    </td>
                    <td>
                      <div className={styles.quotaCredentialCell}>
                        <span className={styles.quotaCredentialName}>{file.name}</span>
                        {metaItems.length > 0 && (
                          <span className={styles.quotaCredentialMeta}>
                            {metaItems.join(' · ')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={styles.quotaStatusCell}>
                        <span
                          className={`${styles.quotaStatusBadge} ${
                            disabledFile ? styles.quotaStatusDisabled : styles.quotaStatusEnabled
                          }`}
                        >
                          {disabledFile
                            ? t('quota_management.filter_disabled')
                            : t('quota_management.filter_enabled')}
                        </span>
                        {onToggleStatus && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className={styles.quotaStatusButton}
                            onClick={() => onToggleStatus(file, disabledFile)}
                            disabled={statusUpdating[file.name] === true}
                            loading={statusUpdating[file.name] === true}
                          >
                            {disabledFile
                              ? t('auth_files.batch_enable')
                              : t('auth_files.batch_disable')}
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className={styles.quotaResultCell}>{renderQuotaCell(file)}</td>
                    <td className={styles.quotaActionsCell}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void refreshQuotaForFile(file)}
                        disabled={disabled || quota[file.name]?.status === 'loading'}
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
