import {
  useCallback,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import {
  IconChevronDown,
  IconDownload,
  IconFilterAll,
  IconInfo,
  IconModelCluster,
  IconPencil,
  IconSearch,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { copyToClipboard } from '@/utils/clipboard';
import { formatFileSize } from '@/utils/format';
import { resolveAuthProvider } from '@/utils/quota';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
  statusBarDataFromRecentRequests,
} from '@/utils/recentRequests';
import {
  QUOTA_PROVIDER_TYPES,
  formatCreated,
  formatCreatedCompact,
  formatModified,
  formatModifiedCompact,
  getAuthFileNumberID,
  getAuthFileIcon,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import {
  HEALTH_LEVEL_I18N_KEY,
  buildHealthSummary,
  classifyAuthFileHealth,
  formatCompactNumber,
  getLastError,
  getRateLimit,
  getWarningCount,
  getWarnings,
  type HealthTone,
} from '@/features/authFiles/health';
import { AuthFileRateLimitEditorModal } from '@/features/authFiles/components/AuthFileRateLimitEditorModal';
import { AuthFileDetailPanel } from '@/features/authFiles/components/AuthFileDetailPanel';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  isAuthFilesSortMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesSortMode,
} from '@/features/authFiles/uiState';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const AUTH_FILES_PAGE_SIZE = 100;
// Keep in sync with the number of <th> columns rendered in the auth-file table;
// used as the colSpan for the expandable detail row.
const AUTH_TABLE_COLUMN_COUNT = 13;

const HEALTH_TONE_CLASS: Record<HealthTone, string> = {
  neutral: styles.tableStateNeutral,
  good: styles.tableStateActive,
  warning: styles.tableStateWarning,
  danger: styles.tableStateError,
};

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

const resolveQuotaType = (file: AuthFileItem): QuotaProviderType | null => {
  const provider = resolveAuthProvider(file);
  if (!QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) return null;
  return provider as QuotaProviderType;
};

const formatRateLimitPair = (current?: number, limit?: number, compact = false): string => {
  const fmt = compact ? formatCompactNumber : (value: number) => String(Math.round(value));
  const safeCurrent = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
  return `${fmt(safeCurrent)}/${hasLimit ? fmt(limit) : '∞'}`;
};

const getProxyURL = (file: AuthFileItem): string => {
  const raw = file.proxy_url ?? file.proxyUrl;
  return typeof raw === 'string' ? raw.trim() : '';
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

const formatProxyHost = (proxyURL: string): string => {
  const raw = proxyURL.trim();
  if (!raw) return '';
  const parse = (value: string) => {
    try {
      return new URL(value).hostname;
    } catch {
      return '';
    }
  };
  const withScheme = raw.includes('://') ? raw : `proxy://${raw}`;
  const parsed = parse(withScheme);
  if (parsed) return parsed;
  const withoutAuth = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw;
  if (withoutAuth.startsWith('[')) {
    const end = withoutAuth.indexOf(']');
    return end > 0 ? withoutAuth.slice(1, end) : withoutAuth;
  }
  return withoutAuth.split('/')[0].split(':')[0].trim();
};

const failureParts = (file: AuthFileItem): { title: string; message: string; tags: string[] }[] => {
  const lastError = getLastError(file);
  const warnings = getWarnings(file);
  const items: { title: string; message: string; tags: string[] }[] = [];

  if (lastError) {
    const tags = [
      lastError.http_status !== undefined ? `HTTP ${lastError.http_status}` : '',
      lastError.code ?? '',
      lastError.retryable === true ? 'retryable' : lastError.retryable === false ? 'final' : '',
    ].filter(Boolean);
    items.push({
      title: 'last_error',
      message: lastError.message || lastError.code || tags.join(' '),
      tags,
    });
  }

  warnings.slice(0, 2).forEach((warning) => {
    const tags = [
      warning.kind ?? '',
      warning.http_status ? `HTTP ${warning.http_status}` : '',
      warning.code ?? '',
      warning.count && warning.count > 1 ? `x${warning.count}` : '',
      warning.model ?? '',
    ].filter(Boolean);
    items.push({
      title: warning.kind || 'warning',
      message: warning.message || tags.join(' '),
      tags,
    });
  });

  return items.filter((item) => item.message || item.tags.length > 0);
};

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'all' | string>('all');
  const [problemOnly, setProblemOnly] = useState(false);
  const [disabledOnly, setDisabledOnly] = useState(false);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const [rateLimitEditorFile, setRateLimitEditorFile] = useState<AuthFileItem | null>(null);
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData();

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
  });

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const pageSize = AUTH_FILES_PAGE_SIZE;

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(normalizeProviderKey(persisted.filter));
      }
      if (typeof persisted.problemOnly === 'boolean') {
        setProblemOnly(persisted.problemOnly);
      }
      if (typeof persisted.disabledOnly === 'boolean') {
        setDisabledOnly(persisted.disabledOnly);
      }
      if (typeof persisted.enabledOnly === 'boolean') {
        setEnabledOnly(persisted.enabledOnly);
      }
      if (typeof persistedCompactMode !== 'boolean' && typeof persisted.compactMode === 'boolean') {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      problemOnly,
      disabledOnly,
      enabledOnly,
      compactMode,
      search,
      page,
      sortMode,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    disabledOnly,
    enabledOnly,
    filter,
    page,
    problemOnly,
    search,
    sortMode,
    uiStateHydrated,
  ]);

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
      void loadFiles().catch(() => {});
    },
    [loadFiles, sortMode]
  );

  const toggleExpand = useCallback((name: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void loadFiles().catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (type) types.add(type);
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingStatusFilters = useMemo(
    () =>
      files.filter((file) => {
        if (problemOnly && !hasAuthFileStatusMessage(file)) return false;
        if (disabledOnly && file.disabled !== true) return false;
        if (enabledOnly && file.disabled === true) return false;
        return true;
      }),
    [disabledOnly, enabledOnly, files, problemOnly]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'number_id', label: t('auth_files.sort_number_id') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
    ],
    [t]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingStatusFilters.length };
    filesMatchingStatusFilters.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (!type) return;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingStatusFilters]);

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(() => {
    const normalizedTerm = normalizedSearch.toLowerCase();

    return filesMatchingStatusFilters.filter((item) => {
      const type = normalizeProviderKey(String(item.type ?? item.provider ?? ''));
      const matchType = normalizedFilter === 'all' || type === normalizedFilter;
      const matchSearch =
        !normalizedSearch ||
        [item.name, item.type, item.provider, getAuthFileNumberID(item)].some((value) => {
          const content = (value || '').toString();
          return wildcardSearch
            ? wildcardSearch.test(content)
            : content.toLowerCase().includes(normalizedTerm);
        });
      return matchType && matchSearch;
    });
  }, [filesMatchingStatusFilters, normalizedFilter, normalizedSearch, wildcardSearch]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortMode === 'default') {
      copy.sort((a, b) => {
        const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
        const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
        const providerCompare = providerA.localeCompare(providerB);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'az') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'number_id') {
      copy.sort((a, b) => {
        const numberA = getAuthFileNumberID(a) ?? Number.MAX_SAFE_INTEGER;
        const numberB = getAuthFileNumberID(b) ?? Number.MAX_SAFE_INTEGER;
        if (numberA !== numberB) return numberA - numberB;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'priority') {
      copy.sort((a, b) => {
        const pa = parsePriorityValue(a.priority ?? a['priority']) ?? 0;
        const pb = parsePriorityValue(b.priority ?? b['priority']) ?? 0;
        return pb - pa; // Higher priority first.
      });
    }
    return copy;
  }, [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedExportFiles = useMemo(
    () => files.filter((file) => selectedFiles.has(file.name)),
    [files, selectedFiles]
  );
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  // Coarse "now" used to classify per-account health (recovery countdowns,
  // etc.). Advances every 30s so badges flip when a cooldown elapses; the
  // expandable detail panel keeps its own per-second ticker for precise values.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(() => setNowMs(Date.now()), 30_000);

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const buildSelectedCredentialsExport = useCallback(() => {
    const rows = selectedExportFiles.map((file) => ({
      account: getAccountName(file),
      order_id: getOrderID(file),
      credential: file.name,
    }));
    return JSON.stringify(rows, null, 2);
  }, [selectedExportFiles]);

  const buildSelectedCredentialsCopyText = useCallback(
    () =>
      selectedExportFiles
        .map((file) => [getAccountName(file), getOrderID(file)].filter(Boolean).join('\t'))
        .join('\n'),
    [selectedExportFiles]
  );

  const copySelectedCredentialsExport = useCallback(async () => {
    if (selectedExportFiles.length === 0) return;
    await copyTextWithNotification(buildSelectedCredentialsCopyText());
  }, [buildSelectedCredentialsCopyText, copyTextWithNotification, selectedExportFiles.length]);

  const downloadSelectedCredentialsExport = useCallback(() => {
    if (selectedExportFiles.length === 0 || typeof document === 'undefined') return;
    const content = buildSelectedCredentialsExport();
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `auth-credentials-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotification(
      t('auth_files.batch_export_download_success', { count: selectedExportFiles.length }),
      'success'
    );
  }, [buildSelectedCredentialsExport, selectedExportFiles.length, showNotification, t]);

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) {
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
      return;
    }

    const updatePadding = () => {
      const height = actionsEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--auth-files-action-bar-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(actionsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
    };
  }, [batchActionBarVisible, selectionCount]);

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const renderFilterTags = () => (
    <div className={styles.filterRail}>
      <div className={styles.filterTags}>
        {existingTypes.map((type) => {
          const isActive = normalizedFilter === type;
          const iconSrc = getAuthFileIcon(type, resolvedTheme);
          const color =
            type === 'all'
              ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
              : getTypeColor(type, resolvedTheme);
          const buttonStyle = {
            '--filter-color': color.text,
            '--filter-surface': color.bg,
            '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
          } as CSSProperties;

          return (
            <button
              key={type}
              className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
              style={buttonStyle}
              onClick={() => {
                setFilter(type);
                setPage(1);
              }}
            >
              <span className={styles.filterTagLabel}>
                {type === 'all' ? (
                  <span className={`${styles.filterTagIconWrap} ${styles.filterAllIconWrap}`}>
                    <IconFilterAll className={styles.filterAllIcon} size={16} />
                  </span>
                ) : (
                  <span className={styles.filterTagIconWrap}>
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className={styles.filterTagIcon} />
                    ) : (
                      <span className={styles.filterTagIconFallback}>
                        {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                <span className={styles.filterTagText}>{getTypeLabel(t, type)}</span>
              </span>
              <span className={styles.filterTagCount}>{typeCounts[type] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('auth_files.title_section')}</span>
      {files.length > 0 && <span className={styles.countBadge}>{files.length}</span>}
    </div>
  );

  const deleteAllButtonLabel = (() => {
    if (disabledOnly || enabledOnly) {
      return t('auth_files.delete_filtered_result_button');
    }
    if (problemOnly) {
      return normalizedFilter === 'all'
        ? t('auth_files.delete_problem_button')
        : t('auth_files.delete_problem_button_with_type', {
            type: getTypeLabel(t, normalizedFilter),
          });
    }
    return normalizedFilter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, normalizedFilter)}`;
  })();

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || uploading}
              loading={uploading}
            >
              {t('auth_files.upload_button')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                handleDeleteAll({
                  filter,
                  problemOnly,
                  disabledOnly,
                  enabledOnly,
                  onResetFilterToAll: () => setFilter('all'),
                  onResetProblemOnly: () => setProblemOnly(false),
                  onResetDisabledOnly: () => setDisabledOnly(false),
                  onResetEnabledOnly: () => setEnabledOnly(false),
                })
              }
              disabled={disableControls || loading || deletingAll}
              loading={deletingAll}
            >
              {deleteAllButtonLabel}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterContent}>
            <div className={styles.filterControlsPanel}>
              <div className={styles.filterControls}>
                <div className={`${styles.filterItem} ${styles.filterSearchItem}`}>
                  <label>{t('auth_files.search_label')}</label>
                  <Input
                    className={styles.searchInput}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('auth_files.search_placeholder')}
                    rightElement={<IconSearch className={styles.searchIcon} size={18} />}
                  />
                </div>
                <div className={styles.filterItem}>
                  <label>{t('auth_files.sort_label')}</label>
                  <Select
                    className={styles.sortSelect}
                    value={sortMode}
                    options={sortOptions}
                    onChange={handleSortModeChange}
                    ariaLabel={t('auth_files.sort_label')}
                    fullWidth
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
                  <label>{t('auth_files.display_options_label')}</label>
                  <div className={styles.filterToggleGroup}>
                    <div className={styles.filterToggleCard}>
                      <ToggleSwitch
                        checked={problemOnly}
                        onChange={(value) => {
                          setProblemOnly(value);
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.problem_filter_only')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.problem_filter_only')}
                          </span>
                        }
                      />
                    </div>
                    <div className={styles.filterToggleCard}>
                      <ToggleSwitch
                        checked={disabledOnly}
                        onChange={(value) => {
                          setDisabledOnly(value);
                          if (value) {
                            setEnabledOnly(false);
                          }
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.disabled_filter_only')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.disabled_filter_only')}
                          </span>
                        }
                      />
                    </div>
                    <div className={styles.filterToggleCard}>
                      <ToggleSwitch
                        checked={enabledOnly}
                        onChange={(value) => {
                          setEnabledOnly(value);
                          if (value) {
                            setDisabledOnly(false);
                          }
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.enabled_filter_only')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.enabled_filter_only')}
                          </span>
                        }
                      />
                    </div>
                    <div className={styles.filterToggleCard}>
                      <ToggleSwitch
                        checked={compactMode}
                        onChange={(value) => setCompactMode(value)}
                        ariaLabel={t('auth_files.compact_mode_label')}
                        label={
                          <span className={styles.filterToggleLabel}>
                            {t('auth_files.compact_mode_label')}
                          </span>
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {loading ? (
              <div className={styles.hint}>{t('common.loading')}</div>
            ) : pageItems.length === 0 ? (
              <EmptyState
                title={t('auth_files.search_empty_title')}
                description={t('auth_files.search_empty_desc')}
              />
            ) : (
              <div className={styles.authTableWrap}>
                <table
                  className={`${styles.authTable} ${compactMode ? styles.authTableCompact : ''}`}
                >
                  <thead>
                    <tr>
                      <th className={styles.authTableSelectCol}>{t('auth_files.table_select')}</th>
                      <th>{t('auth_files.number_id')}</th>
                      <th>{t('auth_files.table_provider')}</th>
                      <th>{t('auth_files.table_credential')}</th>
                      <th>{t('auth_files.table_ip')}</th>
                      <th>{t('auth_files.table_state')}</th>
                      <th>{t('auth_files.table_usage')}</th>
                      <th>{t('auth_files.table_failure_health')}</th>
                      <th>{t('auth_files.table_rate_limits')}</th>
                      <th>{t('auth_files.table_quota_status')}</th>
                      <th>{t('auth_files.file_modified')}</th>
                      <th>{t('auth_files.priority_display')}</th>
                      <th className={styles.authTableActionsCol}>
                        {t('auth_files.table_actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((file) => {
                      const recentBuckets = normalizeRecentRequestBuckets(
                        file.recent_requests ?? file.recentRequests
                      );
                      const fileStats = {
                        success: normalizeUsageTotal(file.success),
                        failure: normalizeUsageTotal(file.failed),
                      };
                      const rateLimit = getRateLimit(file);
                      const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
                      const providerKey = normalizeProviderKey(
                        String(file.type ?? file.provider ?? 'unknown')
                      );
                      const isAistudio = providerKey === 'aistudio';
                      const showModelsButton = !isRuntimeOnly || isAistudio;
                      const typeColor = getTypeColor(providerKey, resolvedTheme);
                      const typeLabel = getTypeLabel(t, providerKey);
                      const providerIcon = getAuthFileIcon(providerKey, resolvedTheme);
                      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
                      const authIndexKey = normalizeRecentRequestAuthIndex(rawAuthIndex);
                      const statusData =
                        (authIndexKey && statusBarCache.get(authIndexKey)) ||
                        statusBarDataFromRecentRequests(recentBuckets);
                      const health = classifyAuthFileHealth(file, nowMs);
                      const stateLabel =
                        health.level === 'virtual'
                          ? t('auth_files.type_virtual')
                          : t(HEALTH_LEVEL_I18N_KEY[health.level]);
                      const stateBadgeClass =
                        health.level === 'virtual'
                          ? styles.tableStateVirtual
                          : health.level === 'disabled'
                            ? styles.tableStateDisabled
                            : HEALTH_TONE_CLASS[health.tone];
                      const healthSummary = buildHealthSummary(file, t, nowMs);
                      const warningCount = getWarningCount(file);
                      const priorityValue = parsePriorityValue(file.priority ?? file['priority']);
                      const numberID = getAuthFileNumberID(file);
                      const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
                      const failures = failureParts(file);
                      const proxyURL = getProxyURL(file);
                      const proxyHost = formatProxyHost(proxyURL);
                      const orderID = getOrderID(file);
                      const selected = selectedFiles.has(file.name);
                      const expanded = expandedRows.has(file.name);
                      const createdLabel = formatCreated(file);
                      const modifiedLabel = formatModified(file);
                      const quotaType = resolveQuotaType(file);

                      return (
                        <Fragment key={file.name}>
                          <tr
                            className={`${selected ? styles.authTableRowSelected : ''} ${file.disabled ? styles.authTableRowDisabled : ''} ${expanded ? styles.authTableRowExpanded : ''}`}
                          >
                            <td className={styles.authTableSelectCol}>
                              {!isRuntimeOnly ? (
                                <SelectionCheckbox
                                  checked={selected}
                                  onChange={() => toggleSelect(file.name)}
                                  className={styles.tableSelection}
                                  aria-label={
                                    selected
                                      ? t('auth_files.batch_deselect')
                                      : t('auth_files.batch_select_all')
                                  }
                                  title={
                                    selected
                                      ? t('auth_files.batch_deselect')
                                      : t('auth_files.batch_select_all')
                                  }
                                />
                              ) : (
                                <span className={styles.tableMuted}>-</span>
                              )}
                            </td>
                            <td className={styles.tableNumberCell}>
                              {numberID ? `#${numberID}` : '-'}
                            </td>
                            <td className={styles.tableProviderCell}>
                              <div className={styles.tableProvider}>
                                <span
                                  className={styles.tableProviderIcon}
                                  title={typeLabel}
                                  aria-label={typeLabel}
                                  style={{
                                    backgroundColor: typeColor.bg,
                                    color: typeColor.text,
                                    ...(typeColor.border ? { border: typeColor.border } : {}),
                                  }}
                                >
                                  {providerIcon ? (
                                    <img src={providerIcon} alt="" />
                                  ) : (
                                    typeLabel.slice(0, 2).toUpperCase()
                                  )}
                                </span>
                              </div>
                            </td>
                            <td className={styles.tableCredentialCell}>
                              <span className={styles.tableFileName} title={file.name}>
                                {file.name}
                              </span>
                              <span className={styles.tableFileCreated} title={createdLabel}>
                                {t('auth_files.file_created')}: {formatCreatedCompact(file)}
                              </span>
                              <span className={styles.tableFileMeta}>
                                {file.size ? formatFileSize(file.size) : '-'}
                                {noteValue
                                  ? ` · ${t('auth_files.note_display')}: ${noteValue}`
                                  : ''}
                              </span>
                            </td>
                            <td className={styles.tableProxyCell}>
                              <div className={styles.tableProxyStack}>
                                {orderID && (
                                  <span className={styles.tableOrderID} title={orderID}>
                                    {orderID}
                                  </span>
                                )}
                                {proxyHost ? (
                                  <span className={styles.tableProxyHost} title={proxyHost}>
                                    {proxyHost}
                                  </span>
                                ) : (
                                  <span className={styles.tableMuted}>-</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className={styles.tableStateStack}>
                                <button
                                  type="button"
                                  className={styles.tableStateToggle}
                                  onClick={() => toggleExpand(file.name)}
                                  aria-expanded={expanded}
                                  title={
                                    expanded
                                      ? t('auth_files.detail_collapse')
                                      : t('auth_files.detail_expand')
                                  }
                                >
                                  <IconChevronDown
                                    size={14}
                                    className={`${styles.tableStateChevron} ${expanded ? styles.tableStateChevronOpen : ''}`}
                                  />
                                  <span className={`${styles.tableStateBadge} ${stateBadgeClass}`}>
                                    {stateLabel}
                                  </span>
                                  {warningCount > 0 && (
                                    <span
                                      className={styles.tableWarningCount}
                                      title={t('auth_files.detail_warnings', {
                                        count: warningCount,
                                      })}
                                    >
                                      {warningCount}
                                    </span>
                                  )}
                                </button>
                                {healthSummary && (
                                  <span className={styles.tableStatusMessage} title={healthSummary}>
                                    <IconInfo size={13} />
                                    <span>{healthSummary}</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className={styles.tableStats}>
                                <span className={styles.tableStatSuccess}>
                                  {t('stats.success')} {fileStats.success}
                                </span>
                                <span className={styles.tableStatFailure}>
                                  {t('stats.failure')} {fileStats.failure}
                                </span>
                              </div>
                            </td>
                            <td className={styles.tableFailureCell}>
                              <div className={styles.tableFailureHealth}>
                                <ProviderStatusBar statusData={statusData} styles={styles} />
                                {failures.length > 0 ? (
                                  <button
                                    type="button"
                                    className={styles.tableFailureButton}
                                    onClick={() => toggleExpand(file.name)}
                                    title={failures
                                      .map((item) =>
                                        [item.title, item.tags.join(' '), item.message]
                                          .filter(Boolean)
                                          .join(' · ')
                                      )
                                      .join('\n')}
                                  >
                                    <span className={styles.tableFailureTags}>
                                      {failures[0].tags.slice(0, 2).map((tag) => (
                                        <span key={tag} className={styles.tableFailureTag}>
                                          {tag}
                                        </span>
                                      ))}
                                    </span>
                                    <span className={styles.tableFailureText}>
                                      {failures[0].message}
                                    </span>
                                    {failures.length > 1 && (
                                      <span className={styles.tableFailureMore}>
                                        +{failures.length - 1}
                                      </span>
                                    )}
                                  </button>
                                ) : fileStats.failure > 0 ? (
                                  <span className={styles.tableMuted}>
                                    {t('auth_files.table_failure_no_detail')}
                                  </span>
                                ) : (
                                  <span className={styles.tableMuted}>-</span>
                                )}
                              </div>
                            </td>
                            <td className={styles.tableRateLimitCell}>
                              <div className={styles.tableRateLimit}>
                                <div className={styles.tableRateLimitGrid}>
                                  <span>
                                    RPM{' '}
                                    {formatRateLimitPair(
                                      rateLimit?.rpm_current,
                                      rateLimit?.rpm_limit
                                    )}
                                  </span>
                                  <span>
                                    TPM{' '}
                                    {formatRateLimitPair(
                                      rateLimit?.tpm_current,
                                      rateLimit?.tpm_limit,
                                      true
                                    )}
                                  </span>
                                  <span>
                                    30m{' '}
                                    {formatRateLimitPair(
                                      rateLimit?.rpm_30m_current,
                                      rateLimit?.rpm_30m_limit
                                    )}
                                  </span>
                                  <span>
                                    10m{' '}
                                    {formatRateLimitPair(
                                      rateLimit?.rpm_10m_current,
                                      rateLimit?.rpm_10m_limit
                                    )}
                                  </span>
                                  <span>
                                    {t('auth_files.rate_hourly')}{' '}
                                    {formatRateLimitPair(
                                      rateLimit?.hourly_current,
                                      rateLimit?.hourly_limit
                                    )}
                                  </span>
                                  <span>
                                    {t('auth_files.rate_concurrency')}{' '}
                                    {formatRateLimitPair(
                                      rateLimit?.in_flight,
                                      rateLimit?.concurrency_limit
                                    )}
                                  </span>
                                </div>
                                {!isRuntimeOnly && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setRateLimitEditorFile(file)}
                                    className={styles.tableRateLimitEdit}
                                    title={t('auth_files.rate_limit_edit_button')}
                                    disabled={disableControls}
                                  >
                                    <IconPencil className={styles.actionIcon} size={15} />
                                  </Button>
                                )}
                              </div>
                            </td>
                            <td className={styles.tableQuotaCell}>
                              {quotaType && !isRuntimeOnly ? (
                                <AuthFileQuotaSection
                                  file={file}
                                  quotaType={quotaType}
                                  disableControls={disableControls}
                                  compact
                                />
                              ) : (
                                <span className={styles.tableMuted}>-</span>
                              )}
                            </td>
                            <td className={styles.tableDateCell} title={modifiedLabel}>
                              {formatModifiedCompact(file)}
                            </td>
                            <td className={styles.tablePriorityCell}>
                              {priorityValue !== undefined ? priorityValue : '-'}
                            </td>
                            <td className={styles.authTableActionsCol}>
                              <div className={styles.tableActions}>
                                {showModelsButton && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => showModels(file)}
                                    className={styles.tableActionButton}
                                    title={t('auth_files.models_button')}
                                    disabled={disableControls}
                                  >
                                    <IconModelCluster className={styles.actionIcon} size={16} />
                                  </Button>
                                )}
                                {!isRuntimeOnly && (
                                  <>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => handleDownload(file.name)}
                                      className={styles.tableActionButton}
                                      title={t('auth_files.download_button')}
                                      disabled={disableControls}
                                    >
                                      <IconDownload className={styles.actionIcon} size={16} />
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => openPrefixProxyEditor(file)}
                                      className={styles.tableActionButton}
                                      title={t('auth_files.prefix_proxy_button')}
                                      disabled={disableControls}
                                    >
                                      <IconSettings className={styles.actionIcon} size={16} />
                                    </Button>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => handleDelete(file.name)}
                                      className={styles.tableActionButton}
                                      title={t('auth_files.delete_button')}
                                      disabled={disableControls || deleting === file.name}
                                    >
                                      {deleting === file.name ? (
                                        <LoadingSpinner size={14} />
                                      ) : (
                                        <IconTrash2 className={styles.actionIcon} size={16} />
                                      )}
                                    </Button>
                                    <ToggleSwitch
                                      ariaLabel={t('auth_files.status_toggle_label')}
                                      checked={!file.disabled}
                                      disabled={
                                        disableControls || statusUpdating[file.name] === true
                                      }
                                      onChange={(value) => handleStatusToggle(file, value)}
                                    />
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className={styles.authTableDetailRow}>
                              <td colSpan={AUTH_TABLE_COLUMN_COUNT}>
                                <AuthFileDetailPanel
                                  file={file}
                                  quotaType={quotaType}
                                  disableControls={disableControls}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && sorted.length > pageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: currentPage,
                    total: totalPages,
                    count: sorted.length,
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <OAuthExcludedCard
        disableControls={disableControls}
        excludedError={excludedError}
        excluded={excluded}
        onAdd={() => openExcludedEditor()}
        onEdit={openExcludedEditor}
        onDelete={deleteExcluded}
      />

      <OAuthModelAliasCard
        disableControls={disableControls}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAdd={() => openModelAliasEditor()}
        onEditProvider={openModelAliasEditor}
        onDeleteProvider={deleteModelAlias}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
      />

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      <AuthFileRateLimitEditorModal
        file={rateLimitEditorFile}
        disabled={disableControls}
        onClose={() => setRateLimitEditorFile(null)}
        onSaved={async () => {
          showNotification(t('auth_files.rate_limit_saved_success'), 'success');
          await loadFiles();
        }}
        onError={(message) =>
          showNotification(`${t('notification.update_failed')}: ${message}`, 'error')
        }
      />

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copySelectedCredentialsExport()}
                    disabled={selectedExportFiles.length === 0}
                  >
                    {t('auth_files.batch_export_copy')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={downloadSelectedCredentialsExport}
                    disabled={selectedExportFiles.length === 0}
                  >
                    {t('auth_files.batch_export_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
