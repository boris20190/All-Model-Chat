import { useCallback, useMemo, useState } from 'react';
import { File as GeminiFile } from '@google/genai';
import { AppSettings } from '../../types';
import { getActiveApiConfig, parseApiKeys } from '../../utils/appUtils';
import { deleteFileApi, listFilesApi } from '../../services/api/fileApi';
import { logService } from '../../services/logService';

const DEFAULT_PAGE_SIZE = 50;

const resolveApiKeyForOverview = (appSettings: AppSettings): string | null => {
  const { apiKeysString } = getActiveApiConfig(appSettings);
  const keys = parseApiKeys(apiKeysString);
  return keys[0] || null;
};

const parseSizeBytes = (file: GeminiFile): number => {
  const raw = (file as Record<string, unknown>).sizeBytes;
  const size = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(size) && size > 0 ? size : 0;
};

export const formatByteSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unexpected files API error.';
};

interface UseFileOverviewProps {
  appSettings: AppSettings;
  onAddFileById?: (fileApiName: string) => Promise<void>;
}

export interface UseFileOverviewState {
  files: GeminiFile[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  nextPageToken: string | null;
  isDeletingByName: Record<string, boolean>;
  isAttachingByName: Record<string, boolean>;
  totalFileCount: number;
  totalBytes: number;
  totalSizeLabel: string;
  canLoadMore: boolean;
  refreshFiles: () => Promise<void>;
  loadMoreFiles: () => Promise<void>;
  deleteRemoteFile: (name: string) => Promise<boolean>;
  copyFileId: (name: string) => Promise<boolean>;
  attachFileById: (name: string) => Promise<boolean>;
  clearError: () => void;
}

export const useFileOverview = ({
  appSettings,
  onAddFileById,
}: UseFileOverviewProps): UseFileOverviewState => {
  const [files, setFiles] = useState<GeminiFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isDeletingByName, setIsDeletingByName] = useState<Record<string, boolean>>({});
  const [isAttachingByName, setIsAttachingByName] = useState<Record<string, boolean>>({});

  const requestFilePage = useCallback(
    async (options: { pageToken?: string; append?: boolean; refreshing?: boolean } = {}): Promise<void> => {
      const apiKey = resolveApiKeyForOverview(appSettings);
      if (!apiKey) {
        setError('API Key not configured.');
        return;
      }

      if (options.refreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        setError(null);
        const payload = await listFilesApi(apiKey, DEFAULT_PAGE_SIZE, options.pageToken);
        const incomingFiles = payload.files || [];
        setFiles((prev) => (options.append ? [...prev, ...incomingFiles] : incomingFiles));
        setNextPageToken(payload.nextPageToken || null);
      } catch (listError) {
        const message = toErrorMessage(listError);
        logService.error('Failed to fetch uploaded files overview.', { error: listError });
        setError(message);
      } finally {
        if (options.refreshing) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [appSettings]
  );

  const refreshFiles = useCallback(async (): Promise<void> => {
    await requestFilePage({ refreshing: true });
  }, [requestFilePage]);

  const loadMoreFiles = useCallback(async (): Promise<void> => {
    if (!nextPageToken) return;
    await requestFilePage({ append: true, pageToken: nextPageToken });
  }, [nextPageToken, requestFilePage]);

  const deleteRemoteFile = useCallback(
    async (name: string): Promise<boolean> => {
      if (!name || !name.startsWith('files/')) {
        setError('Invalid file ID format. Expected "files/your_file_id".');
        return false;
      }

      const apiKey = resolveApiKeyForOverview(appSettings);
      if (!apiKey) {
        setError('API Key not configured.');
        return false;
      }

      setIsDeletingByName((prev) => ({ ...prev, [name]: true }));
      try {
        setError(null);
        await deleteFileApi(apiKey, name);
        setFiles((prev) => prev.filter((file) => file.name !== name));
        return true;
      } catch (deleteError) {
        const message = toErrorMessage(deleteError);
        logService.error(`Failed to delete uploaded file: ${name}`, { error: deleteError });
        setError(message);
        return false;
      } finally {
        setIsDeletingByName((prev) => {
          const { [name]: _removed, ...rest } = prev;
          return rest;
        });
      }
    },
    [appSettings]
  );

  const copyFileId = useCallback(async (name: string): Promise<boolean> => {
    if (!name || !name.startsWith('files/')) {
      setError('Invalid file ID format. Expected "files/your_file_id".');
      return false;
    }

    if (!navigator?.clipboard?.writeText) {
      setError('Clipboard API is not available in this browser context.');
      return false;
    }

    try {
      await navigator.clipboard.writeText(name);
      return true;
    } catch (copyError) {
      const message = toErrorMessage(copyError);
      logService.error(`Failed to copy file ID: ${name}`, { error: copyError });
      setError(message);
      return false;
    }
  }, []);

  const attachFileById = useCallback(
    async (name: string): Promise<boolean> => {
      if (!name || !name.startsWith('files/')) {
        setError('Invalid file ID format. Expected "files/your_file_id".');
        return false;
      }
      if (!onAddFileById) {
        setError('Add-by-ID is unavailable in the current context.');
        return false;
      }

      setIsAttachingByName((prev) => ({ ...prev, [name]: true }));
      try {
        await onAddFileById(name);
        return true;
      } catch (attachError) {
        const message = toErrorMessage(attachError);
        logService.error(`Failed to attach file by ID: ${name}`, { error: attachError });
        setError(message);
        return false;
      } finally {
        setIsAttachingByName((prev) => {
          const { [name]: _removed, ...rest } = prev;
          return rest;
        });
      }
    },
    [onAddFileById]
  );

  const totalBytes = useMemo(() => {
    return files.reduce((sum, file) => sum + parseSizeBytes(file), 0);
  }, [files]);

  const totalFileCount = files.length;
  const totalSizeLabel = useMemo(() => formatByteSize(totalBytes), [totalBytes]);

  return {
    files,
    isLoading,
    isRefreshing,
    error,
    nextPageToken,
    isDeletingByName,
    isAttachingByName,
    totalFileCount,
    totalBytes,
    totalSizeLabel,
    canLoadMore: Boolean(nextPageToken),
    refreshFiles,
    loadMoreFiles,
    deleteRemoteFile,
    copyFileId,
    attachFileById,
    clearError: () => setError(null),
  };
};
