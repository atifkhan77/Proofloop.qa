import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertCircle, Sparkles, CheckCircle2, Download, Trash2, Save, RotateCcw, FileCode2, Info } from 'lucide-react';
import {
  getScripts,
  generateScript,
  updateScript,
  deleteScript,
  type GeneratedScript,
  type UpdateScriptData,
} from '@/lib/api/automation';
import { getProjectTestCases, type TestCase } from '@/lib/api/test-cases';
import { getApiErrorMessage } from '@/lib/api-error';

interface ScriptsModalProps {
  projectId: string;
  /** Automation project whose scripts are shown; null = closed. */
  target: { id: string; name: string } | null;
  canEdit: boolean;
  onClose: () => void;
  /** Script count changed (generate/delete), for the card badge. */
  onCountChange?: (automationProjectId: string, count: number) => void;
}

const STATUS_BADGE: Record<GeneratedScript['status'], string> = {
  DRAFT: 'bg-yellow-500/10 text-yellow-500',
  APPROVED: 'bg-green-500/10 text-green-500',
};

const inputClass =
  'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const buttonClass =
  'inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50';

/** Review, edit, approve and download the Playwright specs generated for one automation project. */
export default function ScriptsModal({ projectId, target, canEdit, onClose, onCountChange }: ScriptsModalProps) {
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftCode, setDraftCode] = useState('');
  const [draftName, setDraftName] = useState('');
  const [testCaseId, setTestCaseId] = useState('');
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'approve' | 'delete'>(null);

  const selected = scripts.find((s) => s.id === selectedId) ?? null;
  const isDirty = !!selected && (draftCode !== selected.code || draftName !== selected.fileName);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    Promise.all([getScripts(target.id), getProjectTestCases(projectId)])
      .then(([s, tc]) => {
        if (cancelled) return;
        setScripts(s);
        setTestCases(tc);
        select(s[0] ?? null);
      })
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, 'Failed to load scripts')))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, projectId]);

  // Close on Escape (unless an edit is unsaved).
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const scriptedTestCaseIds = useMemo(() => new Set(scripts.map((s) => s.testCaseId)), [scripts]);

  if (!target) return null;

  function select(script: GeneratedScript | null) {
    setSelectedId(script?.id ?? null);
    setDraftCode(script?.code ?? '');
    setDraftName(script?.fileName ?? '');
  }

  function close() {
    if (isDirty && !window.confirm('Discard unsaved changes to this script?')) return;
    setScripts([]);
    select(null);
    setTestCaseId('');
    onClose();
  }

  const replace = (updated: GeneratedScript) => {
    // One request at a time (busy), so `scripts` is current here.
    const exists = scripts.some((s) => s.id === updated.id);
    const next = (exists ? scripts.map((s) => (s.id === updated.id ? updated : s)) : [...scripts, updated]).sort((a, b) =>
      a.fileName.localeCompare(b.fileName),
    );
    setScripts(next);
    if (!exists) onCountChange?.(target.id, next.length);
    select(updated);
  };

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Request failed'));
    } finally {
      setBusy(null);
    }
  };

  const onGenerate = (id: string) =>
    run('generate', async () => {
      if (isDirty && !window.confirm('Discard unsaved changes to the current script?')) return;
      const script = await generateScript(target.id, id);
      replace(script);
      setNotice(
        script.warning ??
          (script.source === 'AI'
            ? `Generated with ${script.model}. Review it, then approve to include it in runs.`
            : 'No AI provider configured: generated a template (test.fixme). Implement the steps, then approve.'),
      );
    });

  const onSave = () =>
    selected &&
    run('save', async () => {
      replace(await updateScript(selected.id, { code: draftCode, fileName: draftName.trim() }));
      setNotice(selected.status === 'APPROVED' && draftCode !== selected.code ? 'Saved. Code changed, so the script is back in DRAFT.' : 'Saved.');
    });

  const onToggleApprove = () =>
    selected &&
    run('approve', async () => {
      const status: GeneratedScript['status'] = selected.status === 'APPROVED' ? 'DRAFT' : 'APPROVED';
      // Approving saves pending edits in the same request, so what is approved is what runs.
      const data: UpdateScriptData = status === 'APPROVED' && isDirty ? { code: draftCode, fileName: draftName.trim(), status } : { status };
      replace(await updateScript(selected.id, data));
      setNotice(status === 'APPROVED' ? 'Approved: this script runs on the next execution.' : 'Moved back to DRAFT: excluded from runs.');
    });

  const onDelete = () =>
    selected &&
    window.confirm(`Delete ${selected.fileName}? This cannot be undone.`) &&
    run('delete', async () => {
      await deleteScript(selected.id);
      const next = scripts.filter((s) => s.id !== selected.id);
      setScripts(next);
      onCountChange?.(target.id, next.length);
      select(next[0] ?? null);
    });

  const onDownload = () => {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([draftCode], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = draftName || selected.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scripts-modal-title"
        className="flex h-[90vh] w-full max-w-6xl flex-col rounded-xl border border-border bg-sidebar shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="scripts-modal-title" className="text-xl font-semibold text-foreground">Playwright Scripts</h2>
            <p className="text-sm text-sidebar-foreground">
              {target.name}: generate specs from test cases. Only <span className="font-semibold text-green-500">APPROVED</span> scripts run.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-full p-1 text-sidebar-foreground hover:bg-sidebar-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
            <label htmlFor="scripts-testcase" className="text-sm font-medium text-foreground">Test case</label>
            <select
              id="scripts-testcase"
              value={testCaseId}
              onChange={(e) => setTestCaseId(e.target.value)}
              className={`${inputClass} max-w-md flex-1`}
              disabled={isLoading || testCases.length === 0}
            >
              <option value="">{testCases.length === 0 ? '-- No test cases in this project --' : '-- Select a test case --'}</option>
              {testCases.map((tc) => (
                <option key={tc.id} value={tc.id}>
                  {tc.tcId}: {tc.title}
                  {scriptedTestCaseIds.has(tc.id) ? '  (has script)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => testCaseId && void onGenerate(testCaseId)}
              disabled={!testCaseId || busy !== null}
              className={`${buttonClass} bg-primary py-2 text-primary-foreground hover:bg-primary/90`}
            >
              {busy === 'generate' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              {scriptedTestCaseIds.has(testCaseId) ? 'Regenerate script' : 'Generate script'}
            </button>
          </div>
        )}

        {(error || notice) && (
          <div className="px-6 pt-3">
            {error && (
              <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}
            {notice && !error && (
              <div className="flex items-center space-x-2 rounded-md border border-primary/20 bg-primary/10 p-3 text-foreground" role="status">
                <Info className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm">{notice}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-4 p-6">
          <ul className="w-72 shrink-0 space-y-1 overflow-y-auto" aria-label="Generated scripts">
            {isLoading && (
              <li className="flex justify-center py-6" role="status" aria-label="Loading scripts">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </li>
            )}
            {!isLoading && scripts.length === 0 && (
              <li className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-sidebar-foreground">
                No scripts yet. Pick a test case and generate one.
              </li>
            )}
            {scripts.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (s.id === selectedId) return;
                    if (isDirty && !window.confirm('Discard unsaved changes to this script?')) return;
                    select(s);
                  }}
                  aria-current={s.id === selectedId}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    s.id === selectedId ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-sidebar-accent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground">{s.fileName}</span>
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-sidebar-foreground">
                    {s.testCase.tcId} · {s.source === 'AI' ? 'AI' : 'Template'}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 flex-1 flex-col">
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border text-sidebar-foreground">
                <FileCode2 className="mb-2 h-8 w-8 opacity-50" />
                <span className="text-sm">Select a script to review it.</span>
              </div>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <label htmlFor="script-filename" className="sr-only">File name</label>
                  <input
                    id="script-filename"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    readOnly={!canEdit}
                    className={`${inputClass} max-w-sm font-mono text-xs`}
                  />
                  <span className="text-xs text-sidebar-foreground">
                    {selected.testCase.tcId}: {selected.testCase.title}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => void onSave()} disabled={!isDirty || busy !== null} className={`${buttonClass} border border-border text-foreground hover:bg-sidebar-accent`}>
                          {busy === 'save' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Save
                        </button>
                        <button
                          type="button"
                          onClick={() => void onToggleApprove()}
                          disabled={busy !== null}
                          className={`${buttonClass} ${selected.status === 'APPROVED' ? 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'}`}
                        >
                          {busy === 'approve' ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : selected.status === 'APPROVED' ? (
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          ) : (
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {selected.status === 'APPROVED' ? 'Unapprove' : isDirty ? 'Save & approve' : 'Approve'}
                        </button>
                      </>
                    )}
                    <button type="button" onClick={onDownload} className={`${buttonClass} border border-border text-foreground hover:bg-sidebar-accent`}>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                    </button>
                    {canEdit && (
                      <button type="button" onClick={() => void onDelete()} disabled={busy !== null} aria-label={`Delete ${selected.fileName}`} className={`${buttonClass} text-red-500 hover:bg-red-500/10`}>
                        {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
                <label htmlFor="script-code" className="sr-only">Script code</label>
                <textarea
                  id="script-code"
                  value={draftCode}
                  onChange={(e) => setDraftCode(e.target.value)}
                  readOnly={!canEdit}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-2 text-xs text-sidebar-foreground">
                  Use relative URLs (<code>page.goto('/login')</code>): the run's environment base URL is applied. Environment variables are available as{' '}
                  <code>process.env.KEY</code>.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
