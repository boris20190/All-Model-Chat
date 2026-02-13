import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations } from '../../../utils/appUtils';
import { Settings, MessageSquare, Bot, AlertTriangle, Upload, Download, Trash2, Database, RefreshCw, FileText, Link2, Copy } from 'lucide-react';
import type { UseFileOverviewState } from '../../../hooks/data-management/useFileOverview';
import { formatByteSize } from '../../../hooks/data-management/useFileOverview';

interface DataManagementSectionProps {
  onClearHistory: () => void;
  onClearCache: () => void;
  onOpenLogViewer: () => void;
  onClearLogs: () => void;
  isInstallable: boolean;
  onInstallPwa: () => void;
  onImportSettings: (file: File) => void;
  onExportSettings: () => void;
  onImportHistory: (file: File) => void;
  onExportHistory: () => void;
  onImportScenarios: (file: File) => void;
  onExportScenarios: () => void;
  fileOverview: UseFileOverviewState;
  onReset: () => void;
  t: (key: keyof typeof translations) => string;
}

const ActionRow: React.FC<{ 
    label: string; 
    children: React.ReactNode; 
    description?: string; 
    icon?: React.ReactNode;
    labelClassName?: string;
    className?: string;
}> = ({ label, children, description, icon, labelClassName, className }) => (
    <div className={`flex items-center justify-between py-3 ${className || ''}`}>
        <div className="flex items-center gap-3">
            {icon && <div className={`flex-shrink-0 ${labelClassName ? 'opacity-90' : 'text-[var(--theme-text-tertiary)]'}`}>{icon}</div>}
            <div className="flex flex-col">
                <span className={`text-sm font-medium ${labelClassName || 'text-[var(--theme-text-primary)]'}`}>{label}</span>
                {description && <p className={`text-xs mt-0.5 ${labelClassName ? 'opacity-75' : 'text-[var(--theme-text-tertiary)]'}`}>{description}</p>}
            </div>
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">{children}</div>
    </div>
);

const DataCard: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, icon, children, className }) => (
    <div className={`py-2 ${className || ''}`}>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-tertiary)] mb-2 flex items-center gap-2">
            {icon}
            {title}
        </h4>
        <div className="divide-y divide-[var(--theme-border-primary)]/50">
            {children}
        </div>
    </div>
);

export const DataManagementSection: React.FC<DataManagementSectionProps> = ({
  onClearHistory,
  onClearCache,
  onOpenLogViewer,
  onClearLogs,
  isInstallable,
  onInstallPwa,
  onImportSettings,
  onExportSettings,
  onImportHistory,
  onExportHistory,
  onImportScenarios,
  onExportScenarios,
  fileOverview,
  onReset,
  t,
}) => {
  const settingsImportRef = useRef<HTMLInputElement>(null);
  const historyImportRef = useRef<HTMLInputElement>(null);
  const scenariosImportRef = useRef<HTMLInputElement>(null);
  const chatUploadRef = useRef<HTMLInputElement>(null);
  const hasInitializedOverviewRef = useRef(false);
  const [manualFileId, setManualFileId] = useState('');

  const {
    files,
    isLoading,
    isRefreshing,
    isUploading,
    error,
    nextPageToken,
    isDeletingByName,
    isAttachingByName,
    totalFileCount,
    totalSizeLabel,
    canLoadMore,
    refreshFiles,
    loadMoreFiles,
    uploadFiles,
    deleteRemoteFile,
    copyFileId,
    attachFileById,
    clearError,
  } = fileOverview;

  useEffect(() => {
    if (hasInitializedOverviewRef.current) return;
    hasInitializedOverviewRef.current = true;
    void refreshFiles();
  }, [refreshFiles]);

  const btnClass = "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--theme-bg-secondary)] border flex items-center gap-1.5";
  const outlineBtnClass = `${btnClass} bg-transparent border-[var(--theme-border-secondary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text-primary)]`;
  // Updated white button class for Danger Zone
  const whiteDangerBtnClass = `${btnClass} border-white/30 bg-white/10 text-white hover:bg-white/20 focus:ring-white/50 focus:ring-offset-red-600`;

  const sortedFiles = useMemo(() => {
    const toTimestamp = (value?: string): number => {
      if (!value) return 0;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : 0;
    };

    return [...files].sort((a, b) => {
      const aTime = toTimestamp(a.updateTime || a.createTime);
      const bTime = toTimestamp(b.updateTime || b.createTime);
      return bTime - aTime;
    });
  }, [files]);

  const onManualAttachSubmit = async () => {
    const fileId = manualFileId.trim();
    if (!fileId) return;
    const success = await attachFileById(fileId);
    if (success) setManualFileId('');
  };

  const onDeleteWithConfirmation = async (fileApiName: string) => {
    if (!fileApiName) return;
    const confirmed = window.confirm(
      `${t('settingsFilesOverviewDeleteConfirmPrefix')} "${fileApiName}"? ${t('settingsFilesOverviewDeleteConfirmSuffix')}`
    );
    if (!confirmed) return;
    await deleteRemoteFile(fileApiName);
  };

  const handleChatUploadSelect = async () => {
    const filesToUpload = chatUploadRef.current?.files;
    if (!filesToUpload || filesToUpload.length === 0) return;
    await uploadFiles(filesToUpload);
    if (chatUploadRef.current) {
      chatUploadRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
          <DataCard title="Application Data" icon={<Database size={14} strokeWidth={1.5} />}>
             <ActionRow label="Settings" icon={<Settings size={16} strokeWidth={1.5} />}>
                  <button onClick={onExportSettings} className={outlineBtnClass}><Download size={12} strokeWidth={1.5} /> {t('export')}</button>
                  <button onClick={() => settingsImportRef.current?.click()} className={outlineBtnClass}><Upload size={12} strokeWidth={1.5} /> {t('import')}</button>
                  <input type="file" ref={settingsImportRef} onChange={() => handleFileImport(settingsImportRef, onImportSettings)} accept=".json" className="hidden" />
              </ActionRow>
              <ActionRow label="Chat History" icon={<MessageSquare size={16} strokeWidth={1.5} />}>
                  <button onClick={onExportHistory} className={outlineBtnClass}><Download size={12} strokeWidth={1.5} /> {t('export')}</button>
                  <button onClick={() => historyImportRef.current?.click()} className={outlineBtnClass}><Upload size={12} strokeWidth={1.5} /> {t('import')}</button>
                  <input type="file" ref={historyImportRef} onChange={() => handleFileImport(historyImportRef, onImportHistory)} accept=".json" className="hidden" />
              </ActionRow>
               <ActionRow label="Scenarios" icon={<Bot size={16} strokeWidth={1.5} />}>
                  <button onClick={onExportScenarios} className={outlineBtnClass}><Download size={12} strokeWidth={1.5} /> {t('export')}</button>
                  <button onClick={() => scenariosImportRef.current?.click()} className={outlineBtnClass}><Upload size={12} strokeWidth={1.5} /> {t('import')}</button>
                  <input type="file" ref={scenariosImportRef} onChange={() => handleFileImport(scenariosImportRef, onImportScenarios)} accept=".json" className="hidden" />
              </ActionRow>
          </DataCard>

          <DataCard title={t('settingsFilesOverviewTitle')} icon={<FileText size={14} strokeWidth={1.5} />}>
              <ActionRow
                label={t('settingsFilesOverviewSummaryLabel')}
                description={`${totalFileCount} ${t('settingsFilesOverviewFilesUnit')} • ${totalSizeLabel}${nextPageToken ? ` • ${t('settingsFilesOverviewMorePages')}` : ''}`}
                icon={<Database size={16} strokeWidth={1.5} />}
              >
                <button onClick={() => void refreshFiles()} className={outlineBtnClass} disabled={isRefreshing}>
                  <RefreshCw size={12} strokeWidth={1.5} /> {isRefreshing ? t('settingsFilesOverviewRefreshing') : t('settingsFilesOverviewRefresh')}
                </button>
                <button onClick={() => void loadMoreFiles()} className={outlineBtnClass} disabled={!canLoadMore || isLoading}>
                  {isLoading ? t('settingsFilesOverviewLoading') : t('settingsFilesOverviewLoadMore')}
                </button>
              </ActionRow>

              <ActionRow
                label={t('settingsFilesOverviewUploadLabel')}
                description={t('settingsFilesOverviewUploadDesc')}
                icon={<Upload size={16} strokeWidth={1.5} />}
              >
                <button
                  onClick={() => chatUploadRef.current?.click()}
                  className={outlineBtnClass}
                  disabled={isUploading}
                >
                  <Upload size={12} strokeWidth={1.5} /> {isUploading ? t('settingsFilesOverviewUploading') : t('settingsFilesOverviewUpload')}
                </button>
                <input
                  type="file"
                  multiple
                  ref={chatUploadRef}
                  onChange={() => {
                    void handleChatUploadSelect();
                  }}
                  className="hidden"
                />
              </ActionRow>

              <ActionRow
                label={t('settingsFilesOverviewAttachByIdLabel')}
                description={t('settingsFilesOverviewAttachByIdDesc')}
                icon={<Link2 size={16} strokeWidth={1.5} />}
              >
                <input
                  value={manualFileId}
                  onChange={(event) => setManualFileId(event.target.value)}
                  placeholder={t('settingsFilesOverviewFileIdPlaceholder')}
                  className="w-44 px-2 py-1.5 text-xs rounded-lg border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)]"
                />
                <button
                  onClick={() => void onManualAttachSubmit()}
                  className={outlineBtnClass}
                  disabled={!manualFileId.trim()}
                >
                  {t('settingsFilesOverviewAdd')}
                </button>
              </ActionRow>

              {error && (
                <div className="mt-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400 flex items-center justify-between gap-3">
                  <span className="break-all">{error}</span>
                  <button onClick={clearError} className={outlineBtnClass}>{t('settingsFilesOverviewDismiss')}</button>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {isLoading && sortedFiles.length === 0 && (
                  <div className="text-xs text-[var(--theme-text-tertiary)]">{t('settingsFilesOverviewLoadingList')}</div>
                )}

                {!isLoading && sortedFiles.length === 0 && (
                  <div className="text-xs text-[var(--theme-text-tertiary)]">{t('settingsFilesOverviewEmpty')}</div>
                )}

                {sortedFiles.map((file, index) => {
                  const fileApiName = file.name || '';
                  const displayName = file.displayName || fileApiName || `Unnamed file ${index + 1}`;
                  const fileState = file.state || 'UNKNOWN';
                  const mimeType = file.mimeType || 'unknown';
                  const sizeLabel = formatByteSize(Number(file.sizeBytes || 0));
                  const updatedAt = formatTimestamp(file.updateTime || file.createTime);
                  const isDeleting = Boolean(fileApiName && isDeletingByName[fileApiName]);
                  const isAttaching = Boolean(fileApiName && isAttachingByName[fileApiName]);

                  return (
                    <div key={fileApiName || `${displayName}-${index}`} className="p-3 rounded-lg border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)]">
                      <div className="flex flex-col gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--theme-text-primary)] truncate">{displayName}</p>
                          <p className="text-xs text-[var(--theme-text-tertiary)] break-all">{fileApiName || '-'}</p>
                          <p className="text-xs text-[var(--theme-text-secondary)] mt-1">
                            {mimeType} • {sizeLabel} • {fileState}
                          </p>
                          <p className="text-xs text-[var(--theme-text-tertiary)] mt-1">
                            {t('settingsFilesOverviewUpdatedAt')}: {updatedAt}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              void copyFileId(fileApiName);
                            }}
                            className={outlineBtnClass}
                            disabled={!fileApiName}
                          >
                            <Copy size={12} strokeWidth={1.5} /> {t('settingsFilesOverviewCopyId')}
                          </button>
                          <button
                            onClick={() => {
                              void attachFileById(fileApiName);
                            }}
                            className={outlineBtnClass}
                            disabled={!fileApiName || isAttaching}
                          >
                            <Link2 size={12} strokeWidth={1.5} /> {isAttaching ? t('settingsFilesOverviewAdding') : t('settingsFilesOverviewAdd')}
                          </button>
                          <button
                            onClick={() => {
                              void onDeleteWithConfirmation(fileApiName);
                            }}
                            className={`${outlineBtnClass} text-[var(--theme-text-danger)] hover:bg-[var(--theme-bg-danger)]/10 hover:text-[var(--theme-text-danger)] border-[var(--theme-bg-danger)]/30`}
                            disabled={!fileApiName || isDeleting}
                          >
                            <Trash2 size={12} strokeWidth={1.5} /> {isDeleting ? t('settingsFilesOverviewDeleting') : t('settingsFilesOverviewDelete')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
          </DataCard>
          
          <DataCard title="System & Logs" icon={<Settings size={14} strokeWidth={1.5} />}>
              <ActionRow label={t('settingsViewLogs')}>
                <button onClick={onOpenLogViewer} className={outlineBtnClass}>{t('settingsViewLogs')}</button>
                <button onClick={onClearLogs} className={`${outlineBtnClass} text-[var(--theme-text-danger)] hover:bg-[var(--theme-bg-danger)]/10 hover:text-[var(--theme-text-danger)] border-[var(--theme-bg-danger)]/30`}>
                    <Trash2 size={12} strokeWidth={1.5} /> {t('settingsClearLogs')}
                </button>
              </ActionRow>
              <ActionRow label={t('settingsInstallApp')} description={!isInstallable ? t('settingsInstallApp_unavailable_title') : undefined}>
                <button onClick={onInstallPwa} disabled={!isInstallable} className={`${outlineBtnClass} disabled:opacity-50 disabled:cursor-not-allowed`}>{t('settingsInstallApp')}</button>
              </ActionRow>
          </DataCard>

          {/* DANGER ZONE */}
          <div className="p-5 rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg border border-red-800/50">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-white/10">
                  <AlertTriangle size={16} strokeWidth={2} className="text-white" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      Danger Zone
                  </h4>
              </div>
              
              <div className="divide-y divide-white/10">
                  <ActionRow label={t('settingsReset')} labelClassName="text-white">
                      <button onClick={onReset} className={whiteDangerBtnClass}>
                          <RefreshCw size={12} strokeWidth={1.5} /> {t('settingsReset')}
                      </button>
                  </ActionRow>
                  
                  <ActionRow label={t('settingsClearHistory')} labelClassName="text-white">
                      <button onClick={onClearHistory} className={whiteDangerBtnClass}>
                          <Trash2 size={12} strokeWidth={1.5} /> {t('settingsClearHistory')}
                      </button>
                  </ActionRow>
                  
                  <ActionRow label={t('settingsClearCache')} labelClassName="text-white">
                      <button onClick={onClearCache} className={whiteDangerBtnClass}>
                          <Database size={12} strokeWidth={1.5} /> {t('settingsClearCache')}
                      </button>
                  </ActionRow>
              </div>
          </div>
    </div>
  );

  function handleFileImport(ref: React.RefObject<HTMLInputElement>, handler: (file: File) => void) {
    const file = ref.current?.files?.[0];
    if (file) handler(file);
    if (ref.current) ref.current.value = "";
  }
};

const formatTimestamp = (timestamp?: string): string => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
};
