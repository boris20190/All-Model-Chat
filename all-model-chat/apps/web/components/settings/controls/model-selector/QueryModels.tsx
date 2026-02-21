import React, { useState } from 'react';
import { Search, Plus, Minus, Loader2, AlertCircle } from 'lucide-react';
import { ModelOption } from '../../../../types';
import { fetchBffJson } from '../../../../services/api/bffApi';
import { dbService } from '../../../../utils/db';

interface QueryModelsProps {
    currentModels: ModelOption[];
    onAdd: (model: ModelOption) => void;
    onRemove: (modelId: string) => void;
}

export const QueryModels: React.FC<QueryModelsProps> = ({ currentModels, onAdd, onRemove }) => {
    const [isQuerying, setIsQuerying] = useState(false);
    const [queriedModels, setQueriedModels] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleQuery = async () => {
        setIsQuerying(true);
        setError(null);
        try {
            const settings = await dbService.getAppSettings();
            const headers: Record<string, string> = {};
            if (settings?.useCustomApiConfig && settings?.apiKey) {
                const keys = settings.apiKey.split(',').map(k => k.trim());
                if (keys[0]) {
                    headers['x-api-key-override'] = keys[0];
                }
            }

            const response = await fetchBffJson<{ models: any[] }>('/api/models', {
                method: 'GET',
                headers
            });
            
            setQueriedModels(response.models || []);
        } catch (err: any) {
            setError(err.message || 'Failed to query models');
        } finally {
            setIsQuerying(false);
        }
    };

    if (queriedModels.length === 0 && !isQuerying && !error) {
        return (
            <button
                onClick={handleQuery}
                className="w-full mt-3 py-2 flex items-center justify-center gap-2 text-xs font-medium text-[var(--theme-text-secondary)] bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-secondary)] rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors"
            >
                <Search size={14} /> Query Available Models
            </button>
        );
    }

    return (
        <div className="mt-4 border-t border-[var(--theme-border-secondary)] pt-4 animate-in fade-in">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-[var(--theme-text-primary)]">Available Models</h4>
                <button
                    onClick={handleQuery}
                    disabled={isQuerying}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-[var(--theme-text-primary)] bg-[var(--theme-bg-primary)] border border-[var(--theme-border-secondary)] rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors disabled:opacity-50"
                >
                    {isQuerying ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    Refresh
                </button>
            </div>

            {error && (
                <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-500 text-xs">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <div>{error} <br/> <span className="text-[10px] opacity-80">(Note: Vertex AI users may need to add models manually)</span></div>
                </div>
            )}

            <div className="max-h-[200px] overflow-y-auto custom-scrollbar space-y-1 bg-[var(--theme-bg-input)]/30 rounded-lg p-2 border border-[var(--theme-border-secondary)]">
                {isQuerying && queriedModels.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-[var(--theme-text-tertiary)]">
                        <Loader2 size={18} className="animate-spin" />
                    </div>
                ) : queriedModels.length === 0 && !error ? (
                    <div className="text-center py-4 text-xs text-[var(--theme-text-tertiary)]">
                        No models found.
                    </div>
                ) : (
                    queriedModels.map((m) => {
                        const isAdded = currentModels.some(cm => cm.id === m.id);
                        return (
                            <div key={m.id} className="flex items-center justify-between p-2 rounded bg-[var(--theme-bg-primary)] border border-[var(--theme-border-secondary)] group hover:border-[var(--theme-border-focus)] transition-colors">
                                <div className="min-w-0 flex-1 mr-2">
                                    <div className="text-xs font-medium text-[var(--theme-text-primary)] truncate" title={m.name}>{m.name}</div>
                                    <div className="text-[10px] font-mono text-[var(--theme-text-tertiary)] truncate" title={m.id}>{m.id}</div>
                                </div>
                                <button
                                    onClick={() => isAdded ? onRemove(m.id) : onAdd({ id: m.id, name: m.name, isPinned: true })}
                                    className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                                        isAdded 
                                        ? 'text-red-400 hover:bg-red-400/10' 
                                        : 'text-green-500 hover:bg-green-500/10'
                                    }`}
                                    title={isAdded ? "Remove model" : "Add model"}
                                >
                                    {isAdded ? <Minus size={14} /> : <Plus size={14} />}
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
