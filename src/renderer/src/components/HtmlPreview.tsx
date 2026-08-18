import { useCallback, useEffect, useRef, useState } from 'react'
import { htmlHasRemoteScripts, htmlNeedsRun } from '../lib/htmlFence'
import { CodeBlock } from './CodeBlock'

interface HtmlPreviewProps {
  source: string
  language?: string
}

type ViewMode = 'preview' | 'source'

function downloadHtml(source: string): void {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  const blob = new Blob([source], { type: 'text/html;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `ollama-html-${stamp}.html`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

export function HtmlPreview({
  source,
  language
}: HtmlPreviewProps): React.JSX.Element {
  const needsRun = htmlNeedsRun(source)
  const [mode, setMode] = useState<ViewMode>('preview')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [promptRemote, setPromptRemote] = useState(false)
  const [scriptsOn, setScriptsOn] = useState(false)
  const activeIdRef = useRef<string | null>(null)

  const dropGuest = useCallback(async (): Promise<void> => {
    const id = activeIdRef.current
    activeIdRef.current = null
    setUrl(null)
    setScriptsOn(false)
    if (!id) return
    try {
      await window.api.htmlPreview.destroy(id)
    } catch {
      // already gone
    }
  }, [])

  const createGuest = useCallback(
    async (allowScripts: boolean, allowRemoteScripts: boolean): Promise<void> => {
      await dropGuest()
      setError(null)
      setPromptRemote(false)
      try {
        const created = await window.api.htmlPreview.create({
          html: source,
          allowScripts,
          allowRemoteScripts
        })
        activeIdRef.current = created.id
        setUrl(created.url)
        setScriptsOn(allowScripts)
      } catch {
        setError('Preview failed to load')
      }
    },
    [dropGuest, source]
  )

  useEffect(() => {
    if (mode === 'source') {
      setPromptRemote(false)
      void dropGuest()
      return
    }
    if (!needsRun) {
      void createGuest(false, false)
    }
    return () => {
      void dropGuest()
    }
  }, [mode, needsRun, source, createGuest, dropGuest])

  const onRun = (): void => {
    if (htmlHasRemoteScripts(source)) {
      setPromptRemote(true)
      return
    }
    void createGuest(true, false)
  }

  const label = language?.trim() || 'html'
  const showPoster = mode === 'preview' && needsRun && !url && !promptRemote && !error
  const showPrompt = mode === 'preview' && promptRemote
  const showFrame = mode === 'preview' && Boolean(url)

  return (
    <div className="html-preview">
      <div className="html-preview-header">
        <div className="html-preview-header-left">
          <span className="html-preview-lang">{label}</span>
          <div className="html-preview-toggle" role="tablist" aria-label="HTML view">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'preview'}
              className={mode === 'preview' ? 'is-active' : undefined}
              onClick={() => setMode('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'source'}
              className={mode === 'source' ? 'is-active' : undefined}
              onClick={() => setMode('source')}
            >
              Source
            </button>
          </div>
        </div>
        <div className="html-preview-actions">
          {mode === 'preview' && needsRun && !url && !promptRemote ? (
            <button
              type="button"
              className="html-preview-btn html-preview-btn-primary"
              onClick={onRun}
            >
              Run
            </button>
          ) : null}
          <button
            type="button"
            className="html-preview-btn"
            onClick={() => downloadHtml(source)}
          >
            Download
          </button>
        </div>
      </div>

      {mode === 'source' ? (
        <div className="html-preview-source">
          <CodeBlock code={source} language={label} />
        </div>
      ) : (
        <div className="html-preview-body">
          {error ? <p className="html-preview-error">{error}</p> : null}
          {showPoster ? (
            <div className="html-preview-poster">
              <p>This page needs to run JavaScript.</p>
              <button
                type="button"
                className="html-preview-btn html-preview-btn-primary"
                onClick={onRun}
              >
                Run
              </button>
            </div>
          ) : null}
          {showPrompt ? (
            <div className="html-preview-poster">
              <p>This page loads remote scripts. Allow them?</p>
              <div className="html-preview-actions">
                <button
                  type="button"
                  className="html-preview-btn html-preview-btn-primary"
                  onClick={() => void createGuest(true, true)}
                >
                  Allow
                </button>
                <button
                  type="button"
                  className="html-preview-btn"
                  onClick={() => void createGuest(true, false)}
                >
                  Deny
                </button>
              </div>
            </div>
          ) : null}
          {showFrame ? (
            <iframe
              className="html-preview-frame"
              title="HTML preview"
              src={url ?? undefined}
              sandbox={scriptsOn ? 'allow-scripts' : ''}
              referrerPolicy="no-referrer"
              onError={() => setError('Preview failed to load')}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
