/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import type { QuotaEnabledFilter } from '@/components/quota/QuotaSection';
import styles from './QuotaPage.module.scss';

const FILTERS: QuotaEnabledFilter[] = ['all', 'enabled', 'disabled'];

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<QuotaEnabledFilter>('all');
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});

  const disableControls = connectionStatus !== 'connected';

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  const handleStatusToggle = useCallback(
    async (file: AuthFileItem, enabled: boolean) => {
      const name = file.name;
      const nextDisabled = !enabled;
      const previousDisabled = file.disabled === true;

      setStatusUpdating((prev) => ({ ...prev, [name]: true }));
      setFiles((prev) =>
        prev.map((item) => (item.name === name ? { ...item, disabled: nextDisabled } : item))
      );

      try {
        const res = await authFilesApi.setStatus(name, nextDisabled);
        setFiles((prev) =>
          prev.map((item) => (item.name === name ? { ...item, disabled: res.disabled } : item))
        );
        showNotification(
          enabled
            ? t('auth_files.status_enabled_success', { name })
            : t('auth_files.status_disabled_success', { name }),
          'success'
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setFiles((prev) =>
          prev.map((item) => (item.name === name ? { ...item, disabled: previousDisabled } : item))
        );
        showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      } finally {
        setStatusUpdating((prev) => {
          if (!prev[name]) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [showNotification, t]
  );

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
        <div className={styles.quotaFilterBar}>
          {FILTERS.map((filter) => (
            <Button
              key={filter}
              variant="secondary"
              size="sm"
              className={`${styles.quotaFilterButton} ${
                enabledFilter === filter ? styles.quotaFilterButtonActive : ''
              }`}
              onClick={() => setEnabledFilter(filter)}
            >
              {t(`quota_management.filter_${filter}`)}
            </Button>
          ))}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        enabledFilter={enabledFilter}
        statusUpdating={statusUpdating}
        onToggleStatus={handleStatusToggle}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        enabledFilter={enabledFilter}
        statusUpdating={statusUpdating}
        onToggleStatus={handleStatusToggle}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        enabledFilter={enabledFilter}
        statusUpdating={statusUpdating}
        onToggleStatus={handleStatusToggle}
      />
      <QuotaSection
        config={XAI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        enabledFilter={enabledFilter}
        statusUpdating={statusUpdating}
        onToggleStatus={handleStatusToggle}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        enabledFilter={enabledFilter}
        statusUpdating={statusUpdating}
        onToggleStatus={handleStatusToggle}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        enabledFilter={enabledFilter}
        statusUpdating={statusUpdating}
        onToggleStatus={handleStatusToggle}
      />
    </div>
  );
}
