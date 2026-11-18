import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle, Globe, Plus, ChevronDown, ChevronRight, Lock, KeyRound } from 'lucide-react';
import {
  createEnvironment,
  getEnvironmentVariables,
  createEnvironmentVariable,
  type Environment,
  type EnvironmentVariable,
} from '@/lib/api/automation';
import { getApiErrorMessage } from '@/lib/api-error';
import { safeUrlSchema } from '@/lib/safe-url';

// Mirrors apps/api/src/validations/environment.validation.ts.
const envSchema = z.object({
  name: z.string().trim().toUpperCase().min(1, 'Environment name is required'),
  baseUrl: safeUrlSchema.optional(),
});

type EnvForm = z.infer<typeof envSchema>;

interface ManageEnvironmentsModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Environments are loaded by the page (the Run dialog needs them too). */
  environments: Environment[];
  onEnvironmentCreated: (env: Environment) => void;
}

const inputClass =
  'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function ManageEnvironmentsModal({
  projectId,
  isOpen,
  onClose,
  environments,
  onEnvironmentCreated,
}: ManageEnvironmentsModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [expandedEnvId, setExpandedEnvId] = useState<string | null>(null);
  const [variablesByEnv, setVariablesByEnv] = useState<Record<string, EnvironmentVariable[]>>({});
  const [loadingVarsByEnv, setLoadingVarsByEnv] = useState<Record<string, boolean>>({});
  const [varErrorByEnv, setVarErrorByEnv] = useState<Record<string, string | null>>({});

  // Variable sub-form state
  const [varKey, setVarKey] = useState('');
  const [varValue, setVarValue] = useState('');
  const [varIsSecret, setVarIsSecret] = useState(false);
  const [isAddingVar, setIsAddingVar] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EnvForm>({ resolver: zodResolver(envSchema) });

  const loadVariables = async (envId: string) => {
    try {
      setLoadingVarsByEnv((prev) => ({ ...prev, [envId]: true }));
      setVarErrorByEnv((prev) => ({ ...prev, [envId]: null }));
      const vars = await getEnvironmentVariables(envId);
      setVariablesByEnv((prev) => ({ ...prev, [envId]: vars }));
    } catch (err) {
      setVarErrorByEnv((prev) => ({ ...prev, [envId]: getApiErrorMessage(err, 'Failed to load variables') }));
    } finally {
      setLoadingVarsByEnv((prev) => ({ ...prev, [envId]: false }));
    }
  };

  const toggleExpand = (envId: string) => {
    if (expandedEnvId === envId) {
      setExpandedEnvId(null);
    } else {
      setExpandedEnvId(envId);
      if (!variablesByEnv[envId]) {
        loadVariables(envId);
      }
    }
  };

  const handleAddVariable = async (e: React.FormEvent, envId: string) => {
    e.preventDefault();
    if (!varKey.trim() || !varValue) return;

    try {
      setIsAddingVar(true);
      setVarErrorByEnv((prev) => ({ ...prev, [envId]: null }));
      const newVar = await createEnvironmentVariable(envId, {
        key: varKey.trim(),
        value: varValue,
        isSecret: varIsSecret,
      });

      setVariablesByEnv((prev) => ({
        ...prev,
        [envId]: [...(prev[envId] || []), newVar],
      }));

      // Reset sub-form
      setVarKey('');
      setVarValue('');
      setVarIsSecret(false);
    } catch (err) {
      setVarErrorByEnv((prev) => ({ ...prev, [envId]: getApiErrorMessage(err, 'Failed to add variable') }));
    } finally {
      setIsAddingVar(false);
    }
  };

  const close = () => {
    reset();
    setServerError(null);
    setExpandedEnvId(null);
    onClose();
  };

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const onSubmit = async (data: EnvForm) => {
    try {
      setServerError(null);
      const newEnv = await createEnvironment(projectId, data);
      onEnvironmentCreated(newEnv);
      reset(); // stay open so several environments can be added
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Failed to create environment'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="env-modal-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="env-modal-title" className="text-xl font-semibold text-foreground">Manage Environments</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {serverError && (
          <div className="mb-4 flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mb-6 shrink-0 space-y-4 border-b border-border pb-6" noValidate>
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="env-name" className="block text-sm font-medium text-foreground">Environment Name</label>
              <input
                id="env-name"
                placeholder="e.g., STAGING"
                {...register('name')}
                aria-invalid={!!errors.name}
                className={`mt-1 ${inputClass}`}
                autoComplete="off"
                autoFocus
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div>
              <label htmlFor="env-url" className="block text-sm font-medium text-foreground">Base URL (Optional)</label>
              <div className="mt-1 flex space-x-2">
                <input
                  id="env-url"
                  placeholder="https://staging.example.com"
                  {...register('baseUrl')}
                  aria-invalid={!!errors.baseUrl}
                  className={inputClass}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  aria-label="Add environment"
                  className="flex shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
              {errors.baseUrl && <p className="mt-1 text-xs text-red-500">{errors.baseUrl.message}</p>}
            </div>
          </div>
        </form>

        <div className="min-h-[220px] flex-1 overflow-y-auto">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Configured Environments</h3>
          {environments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-sidebar-accent/30 py-8 text-center text-sm text-sidebar-foreground">
              No environments configured for this project.
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Configured environments">
              {environments.map((env) => {
                const isExpanded = expandedEnvId === env.id;
                const vars = variablesByEnv[env.id] || [];
                const isLoadingVars = loadingVarsByEnv[env.id] || false;
                const varError = varErrorByEnv[env.id];

                return (
                  <li key={env.id} className="rounded-lg border border-border bg-background transition-colors overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleExpand(env.id)}
                      className="flex w-full cursor-pointer items-center justify-between p-3 text-left hover:bg-sidebar-accent/20"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <Globe className="h-5 w-5 shrink-0 text-sidebar-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-foreground">{env.name}</p>
                          {env.baseUrl && <p className="truncate font-mono text-xs text-sidebar-foreground">{env.baseUrl}</p>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-xs text-sidebar-foreground flex items-center gap-1 font-medium">
                          <KeyRound className="h-3.5 w-3.5" /> Variables Vault
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-sidebar-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-sidebar-foreground" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border bg-sidebar/50 p-4 space-y-4">
                        {varError && (
                          <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-500" role="alert">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>{varError}</span>
                          </div>
                        )}

                        {/* Add Variable Sub-form */}
                        <form onSubmit={(e) => handleAddVariable(e, env.id)} className="space-y-3 rounded-md border border-border/60 bg-background/50 p-3">
                          <p className="text-xs font-semibold text-foreground">Add Environment Variable</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label htmlFor={`var-key-${env.id}`} className="block text-[11px] font-medium text-sidebar-foreground">
                                Variable Key
                              </label>
                              <input
                                id={`var-key-${env.id}`}
                                placeholder="e.g. API_TOKEN"
                                value={varKey}
                                onChange={(e) => setVarKey(e.target.value.toUpperCase())}
                                className={`mt-0.5 ${inputClass} font-mono uppercase text-xs`}
                                required
                              />
                            </div>
                            <div>
                              <label htmlFor={`var-val-${env.id}`} className="block text-[11px] font-medium text-sidebar-foreground">
                                Variable Value
                              </label>
                              <input
                                id={`var-val-${env.id}`}
                                placeholder="Value / Secret"
                                type={varIsSecret ? 'password' : 'text'}
                                value={varValue}
                                onChange={(e) => setVarValue(e.target.value)}
                                className={`mt-0.5 ${inputClass} text-xs`}
                                required
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <label className="flex items-center space-x-2 text-xs text-sidebar-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={varIsSecret}
                                onChange={(e) => setVarIsSecret(e.target.checked)}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              />
                              <span>Secret (masked in API responses)</span>
                            </label>

                            <button
                              type="submit"
                              disabled={isAddingVar || !varKey.trim() || !varValue}
                              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              {isAddingVar ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Plus className="mr-1 h-3 w-3" />
                              )}
                              Add Variable
                            </button>
                          </div>
                        </form>

                        {/* Variables List */}
                        <div>
                          <p className="mb-2 text-xs font-medium text-sidebar-foreground">Variables in this Environment</p>
                          {isLoadingVars ? (
                            <div className="flex h-16 items-center justify-center">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            </div>
                          ) : vars.length === 0 ? (
                            <p className="text-xs text-sidebar-foreground italic py-2">
                              No variables stored in this environment yet.
                            </p>
                          ) : (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {vars.map((v) => (
                                <div
                                  key={v.id}
                                  className="flex items-center justify-between rounded border border-border/50 bg-background px-3 py-2 text-xs"
                                >
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <span className="font-mono font-semibold text-foreground truncate">{v.key}</span>
                                    <span className="text-sidebar-foreground">=</span>
                                    <span className="font-mono text-sidebar-foreground truncate">{v.value}</span>
                                  </div>
                                  {v.isSecret && (
                                    <span className="inline-flex shrink-0 items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                                      <Lock className="mr-1 h-2.5 w-2.5" /> Secret
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
