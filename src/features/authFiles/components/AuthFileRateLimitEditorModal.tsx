import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authFilesApi, type AuthFileFieldsPatch } from '@/services/api';
import type { AuthFileItem, AuthFileRateLimit } from '@/types';
import { getRateLimit } from '@/features/authFiles/health';
import styles from '@/pages/AuthFilesPage.module.scss';

type LimitField = 'rpm_limit' | 'tpm_limit' | 'rpm_30m_limit' | 'concurrency_limit';

export type AuthFileRateLimitEditorModalProps = {
  file: AuthFileItem | null;
  disabled: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onError: (message: string) => void;
};

const limitValue = (rateLimit: AuthFileRateLimit | null, field: LimitField): string => {
  const value = rateLimit?.[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : '';
};

const parseLimit = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
};

export function AuthFileRateLimitEditorModal({
  file,
  disabled,
  onClose,
  onSaved,
  onError,
}: AuthFileRateLimitEditorModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<LimitField, string>>({
    rpm_limit: '',
    tpm_limit: '',
    rpm_30m_limit: '',
    concurrency_limit: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rateLimit = file ? getRateLimit(file) : null;
    setValues({
      rpm_limit: limitValue(rateLimit, 'rpm_limit'),
      tpm_limit: limitValue(rateLimit, 'tpm_limit'),
      rpm_30m_limit: limitValue(rateLimit, 'rpm_30m_limit'),
      concurrency_limit: limitValue(rateLimit, 'concurrency_limit'),
    });
    setError(null);
    setSaving(false);
  }, [file]);

  const title = file
    ? t('auth_files.rate_limit_editor_title', { name: file.name })
    : t('auth_files.rate_limit_editor_title_empty');

  const dirty = useMemo(() => {
    if (!file) return false;
    const rateLimit = getRateLimit(file);
    return (Object.keys(values) as LimitField[]).some(
      (field) => values[field].trim() !== limitValue(rateLimit, field)
    );
  }, [file, values]);

  const handleChange = (field: LimitField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
  };

  const handleSave = async () => {
    if (!file || saving) return;
    const patch: AuthFileFieldsPatch = {};
    for (const field of Object.keys(values) as LimitField[]) {
      const parsed = parseLimit(values[field]);
      if (parsed === null) {
        setError(t('auth_files.rate_limit_invalid'));
        return;
      }
      patch[field] = parsed;
    }

    setSaving(true);
    try {
      await authFilesApi.patchFields(file.name, patch);
      await onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.update_failed');
      setError(message);
      onError(message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(file)}
      onClose={onClose}
      closeDisabled={saving}
      width={520}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={disabled || saving || !dirty}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className={styles.rateLimitEditor}>
        {error && <div className={styles.prefixProxyError}>{error}</div>}
        <div className={styles.rateLimitEditorGrid}>
          <Input
            label={t('auth_files.rpm_limit_label')}
            value={values.rpm_limit}
            placeholder="2"
            hint={t('auth_files.rate_limit_hint')}
            disabled={disabled || saving}
            onChange={(event) => handleChange('rpm_limit', event.target.value)}
          />
          <Input
            label={t('auth_files.tpm_limit_label')}
            value={values.tpm_limit}
            placeholder="500000"
            hint={t('auth_files.rate_limit_hint')}
            disabled={disabled || saving}
            onChange={(event) => handleChange('tpm_limit', event.target.value)}
          />
          <Input
            label={t('auth_files.rpm_30m_limit_label')}
            value={values.rpm_30m_limit}
            placeholder="10"
            hint={t('auth_files.rate_limit_hint')}
            disabled={disabled || saving}
            onChange={(event) => handleChange('rpm_30m_limit', event.target.value)}
          />
          <Input
            label={t('auth_files.concurrency_limit_label')}
            value={values.concurrency_limit}
            placeholder="3"
            hint={t('auth_files.rate_limit_hint')}
            disabled={disabled || saving}
            onChange={(event) => handleChange('concurrency_limit', event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
