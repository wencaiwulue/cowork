import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Play,
  X,
} from 'lucide-react'
import type {
  MigrationSource,
  MigrationSourceInfo,
  MigrationResult,
} from '../../../../main/ipc'
import './migrationWizard.css'

export interface MigrationWizardProps {
  sources: MigrationSourceInfo[]
  onDone: () => void
}

type Selection =
  | { kind: 'source'; source: MigrationSource }
  | { kind: 'fresh' }
  | null

type Phase =
  | { kind: 'choose' }
  | { kind: 'performing'; label: string }
  | { kind: 'done'; result: MigrationResult; sourceLabel: string }
  | { kind: 'error'; message: string }

/**
 * First-run migration wizard modal. Mirrors the modal-backdrop /
 * confirmation-modal pattern used in App.tsx (L14000-14029) and reuses the
 * focus-trap helper passed in via props. See
 * docs/design/2026-08-08-migration-wizard.md §3.1 / §5.3.
 *
 * Pull mode: App.tsx calls `claudeDesktop.migration.getSources()` on mount and
 * renders this component only when at least one viable source is returned.
 * The user picks a source (or "Start fresh") and clicks Import / Skip; we
 * invoke the corresponding IPC and dismiss via `onDone()`.
 */
export function MigrationWizard({ sources, onDone }: MigrationWizardProps): ReactElement {
  const [selection, setSelection] = useState<Selection>(null)
  const [expandedSource, setExpandedSource] = useState<MigrationSource | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' })
  const modalRef = useRef<HTMLElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  // Auto-select the first source and focus the primary button on mount.
  useEffect(() => {
    if (sources.length > 0) {
      setSelection({ kind: 'source', source: sources[0]!.source })
    } else {
      setSelection({ kind: 'fresh' })
    }
    requestAnimationFrame(() => {
      primaryButtonRef.current?.focus()
    })
  }, [sources])

  // Focus trap (Tab / Shift-Tab) — mirrors App.tsx trapModalFocus (L2483).
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = [
        ...modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(el => el.offsetParent !== null || el === document.activeElement)
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (event.shiftKey && (!active || active === first || !modalRef.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // Escape dismisses (Skip) — only in the choose phase.
  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape' && phase.kind === 'choose') {
        void handleSkip()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  async function handleImport(): Promise<void> {
    if (!selection) return
    if (selection.kind === 'fresh') {
      // "Start fresh" is equivalent to Skip — stamp the gate file.
      try {
        setPhase({ kind: 'performing', label: 'Starting fresh' })
        await window.claudeDesktop.migration.skip()
        onDone()
      } catch (err) {
        setPhase({ kind: 'error', message: errorMessage(err) })
      }
      return
    }
    const source = selection.source
    const info = sources.find(s => s.source === source)
    const label = info?.label ?? source
    try {
      setPhase({ kind: 'performing', label })
      const result = await window.claudeDesktop.migration.perform(source)
      setPhase({ kind: 'done', result, sourceLabel: label })
    } catch (err) {
      setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }

  async function handleSkip(): Promise<void> {
    try {
      setPhase({ kind: 'performing', label: 'Skipping' })
      await window.claudeDesktop.migration.skip()
      onDone()
    } catch (err) {
      setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }

  const busy = phase.kind === 'performing'
  const canImport = selection !== null && !busy

  return (
    <div
      className="modal-backdrop migration-wizard-backdrop"
      role="presentation"
    >
      <section
        ref={modalRef}
        className="confirmation-modal migration-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-wizard-title"
      >
        <div className="eyebrow">First-time setup</div>
        <h2 id="migration-wizard-title">Import your data</h2>
        <p className="migration-wizard-subtitle">
          Bring your existing settings into Kode, or start fresh. You can always
          run the original tool alongside — migration is copy-only.
        </p>

        {phase.kind === 'choose' && (
          <ul className="migration-source-list" role="radiogroup" aria-label="Import source">
            {sources.map(source => (
              <li key={source.source}>
                <MigrationSourceCard
                  source={source}
                  selected={selection?.kind === 'source' && selection.source === source.source}
                  expanded={expandedSource === source.source}
                  onSelect={() => setSelection({ kind: 'source', source: source.source })}
                  onToggleExpand={() =>
                    setExpandedSource(prev =>
                      prev === source.source ? null : source.source,
                    )
                  }
                />
              </li>
            ))}
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={selection?.kind === 'fresh'}
                className={`migration-source-card ${selection?.kind === 'fresh' ? 'selected' : ''}`}
                onClick={() => setSelection({ kind: 'fresh' })}
              >
                <span className="migration-source-radio" aria-hidden="true">
                  {selection?.kind === 'fresh' ? <Check size={14} /> : null}
                </span>
                <span className="migration-source-meta">
                  <strong>Start fresh</strong>
                  <small>Skip import and begin with a clean Kode setup.</small>
                </span>
              </button>
            </li>
          </ul>
        )}

        {phase.kind === 'performing' && (
          <div className="migration-wizard-status" role="status" aria-live="polite">
            <span className="migration-spinner" aria-hidden="true" />
            Importing from {phase.label}…
          </div>
        )}

        {phase.kind === 'done' && (
          <MigrationResultView
            result={phase.result}
            sourceLabel={phase.sourceLabel}
            onDone={onDone}
          />
        )}

        {phase.kind === 'error' && (
          <div className="migration-wizard-status error" role="alert">
            <strong>Migration failed.</strong>
            <span>{phase.message}</span>
            <button
              type="button"
              className="tool-button"
              onClick={() => setPhase({ kind: 'choose' })}
            >
              Back
            </button>
          </div>
        )}

        {(phase.kind === 'choose' || phase.kind === 'error') && (
          <div className="modal-actions">
            <button
              type="button"
              className="tool-button"
              onClick={() => void handleSkip()}
              disabled={busy}
            >
              <X size={14} />
              Skip
            </button>
            <button
              ref={primaryButtonRef}
              type="button"
              className="send-button"
              onClick={() => void handleImport()}
              disabled={!canImport}
            >
              <Play size={14} />
              {selection?.kind === 'fresh' ? 'Start fresh' : 'Import'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

interface MigrationSourceCardProps {
  source: MigrationSourceInfo
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggleExpand: () => void
}

function MigrationSourceCard({
  source,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
}: MigrationSourceCardProps): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`migration-source-card ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span className="migration-source-radio" aria-hidden="true">
        {selected ? <Check size={14} /> : null}
      </span>
      <span className="migration-source-meta">
        <strong>{source.label}</strong>
        <small className="migration-source-path">{source.homeDir}</small>
        {source.globalFile && (
          <small className="migration-source-path">{source.globalFile}</small>
        )}
        <small className="migration-source-count">
          {source.totalItemCount} item{source.totalItemCount === 1 ? '' : 's'} to import
        </small>
      </span>
      {source.items.length > 0 && (
        <button
          type="button"
          className="migration-source-expand"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpand()
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}
      {expanded && source.items.length > 0 && (
        <ul className="migration-item-list" role="presentation">
          {source.items.map(item => (
            <li key={item.sourcePath} className="migration-item">
              <Folder size={12} aria-hidden="true" />
              <span className="migration-item-description">{item.description}</span>
              <span className="migration-item-count">{item.itemCount}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  )
}

interface MigrationResultViewProps {
  result: MigrationResult
  sourceLabel: string
  onDone: () => void
}

function MigrationResultView({
  result,
  sourceLabel,
  onDone,
}: MigrationResultViewProps): ReactElement {
  const hasWarnings = result.warnings.length > 0
  const hasSkipped = result.skippedItems.length > 0
  return (
    <div className="migration-wizard-result">
      <p>
        Imported <strong>{result.migratedItems.length}</strong> item
        {result.migratedItems.length === 1 ? '' : 's'} from {sourceLabel}.
      </p>
      {hasSkipped && (
        <details className="migration-wizard-details">
          <summary>Skipped ({result.skippedItems.length})</summary>
          <ul>
            {result.skippedItems.map(item => (
              <li key={item.path}>
                <code>{item.path}</code>
                <span> — {item.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {hasWarnings && (
        <details className="migration-wizard-details">
          <summary>Warnings ({result.warnings.length})</summary>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="send-button"
          onClick={onDone}
          autoFocus
        >
          <Check size={14} />
          Continue
        </button>
      </div>
    </div>
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
