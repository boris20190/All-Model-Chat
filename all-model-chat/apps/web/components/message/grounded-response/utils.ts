
export const getDomain = (url: string) => {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
};

export const getFavicon = (url: string, title?: string) => {
    try {
        // Heuristic: If title looks like a domain (has dot, no spaces), use it.
        // This helps when the URI is a proxy/redirect (e.g. Vertex AI Search).
        if (title && title.includes('.') && !title.trim().includes(' ')) {
            return `https://www.google.com/s2/favicons?domain=${title.trim()}&sz=64`;
        }
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch {
        return null;
    }
};

export const extractSources = (metadata: any) => {
    if (!metadata) return [];

    const uniqueSources = new Map<string, { uri: string; title: string }>();

    const addSource = (uri: string, title?: string) => {
        if (uri && !uniqueSources.has(uri)) {
            uniqueSources.set(uri, { uri, title: title || new URL(uri).hostname });
        }
    };

    if (metadata.groundingChunks && Array.isArray(metadata.groundingChunks)) {
        metadata.groundingChunks.forEach((chunk: any) => {
            if (chunk?.web?.uri) {
                addSource(chunk.web.uri, chunk.web.title);
            }
        });
    }

    if (metadata.citations && Array.isArray(metadata.citations)) {
        metadata.citations.forEach((citation: any) => {
            if (citation?.uri) {
                addSource(citation.uri, citation.title);
            }
        });
    }

    return Array.from(uniqueSources.values());
};
