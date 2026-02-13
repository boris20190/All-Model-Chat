
import { File as GeminiFile } from "@google/genai";
import type {
    FileDeleteResponse,
    FileListResponse,
    FileMetadataResponse,
    FileUploadResponse,
} from '@all-model-chat/shared-api';
import { fetchBffJson, parseBffErrorResponse, resolveBffEndpoint } from './bffApi';
import { logService } from "../logService";

/**
 * Uploads a file using the official SDK.
 * Reverted from XHR to SDK for stability.
 */
export const uploadFileApi = async (
    apiKey: string, 
    file: File, 
    mimeType: string, 
    displayName: string, 
    signal: AbortSignal,
    onProgress?: (loaded: number, total: number) => void
): Promise<GeminiFile> => {
    void apiKey;
    logService.info(`Uploading file via BFF: ${displayName}`, { mimeType, size: file.size });
    
    if (signal.aborted) {
        const abortError = new Error("Upload cancelled by user.");
        abortError.name = "AbortError";
        throw abortError;
    }

    try {
        const params = new URLSearchParams({
            displayName,
            mimeType,
        });

        const endpoint = resolveBffEndpoint(`/api/files/upload?${params.toString()}`);
        const binaryBody = await file.arrayBuffer();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/octet-stream',
            },
            body: binaryBody,
            signal,
        });

        if (!response.ok) {
            throw await parseBffErrorResponse(response);
        }

        const payload = (await response.json()) as FileUploadResponse<GeminiFile>;
        const uploadResult = payload.file;

        // Since SDK doesn't provide progress, call 100% on completion to satisfy UI
        if (onProgress) {
            onProgress(file.size, file.size);
        }

        return uploadResult;

    } catch (error) {
        logService.error(`Failed to upload file "${displayName}" to Gemini API:`, error);
        
        // If it's an abort, ensure we throw a specific error for UI handling
        if (signal.aborted) {
            const abortError = new Error("Upload cancelled by user.");
            abortError.name = "AbortError";
            throw abortError;
        }
        
        throw error;
    }
};

export const getFileMetadataApi = async (apiKey: string, fileApiName: string): Promise<GeminiFile | null> => {
    void apiKey;
    if (!fileApiName || !fileApiName.startsWith('files/')) {
        logService.error(`Invalid fileApiName format: ${fileApiName}. Must start with "files/".`);
        throw new Error('Invalid file ID format. Expected "files/your_file_id".');
    }
    try {
        logService.info(`Fetching metadata for file: ${fileApiName}`);
        const params = new URLSearchParams({ name: fileApiName });
        const payload = await fetchBffJson<FileMetadataResponse<GeminiFile>>(
            `/api/files/metadata?${params.toString()}`,
            {
                method: 'GET',
            }
        );
        return payload.file;
    } catch (error) {
        logService.error(`Failed to get metadata for file "${fileApiName}" from BFF:`, error);
        if (error instanceof Error && (error.message.includes('NOT_FOUND') || error.message.includes('404'))) {
            return null; // File not found is a valid outcome we want to handle
        }
        throw error; // Re-throw other errors
    }
};

export const listFilesApi = async (
    apiKey: string,
    pageSize?: number,
    pageToken?: string
): Promise<FileListResponse<GeminiFile>> => {
    void apiKey;

    if (typeof pageSize === 'number' && (!Number.isInteger(pageSize) || pageSize <= 0)) {
        throw new Error('Invalid `pageSize`. Expected a positive integer.');
    }

    const params = new URLSearchParams();
    if (typeof pageSize === 'number') {
        params.set('pageSize', String(pageSize));
    }
    if (pageToken?.trim()) {
        params.set('pageToken', pageToken.trim());
    }

    const query = params.toString();
    const path = query ? `/api/files/list?${query}` : '/api/files/list';

    logService.info('Fetching uploaded files list via BFF.', {
        pageSize: typeof pageSize === 'number' ? pageSize : undefined,
        hasPageToken: Boolean(pageToken?.trim()),
    });

    return fetchBffJson<FileListResponse<GeminiFile>>(path, { method: 'GET' });
};

export const deleteFileApi = async (apiKey: string, fileApiName: string): Promise<FileDeleteResponse> => {
    void apiKey;

    if (!fileApiName || !fileApiName.startsWith('files/')) {
        throw new Error('Invalid file ID format. Expected "files/your_file_id".');
    }

    const params = new URLSearchParams({ name: fileApiName });
    logService.info(`Deleting uploaded file via BFF: ${fileApiName}`);

    return fetchBffJson<FileDeleteResponse>(`/api/files/delete?${params.toString()}`, {
        method: 'DELETE',
    });
};
