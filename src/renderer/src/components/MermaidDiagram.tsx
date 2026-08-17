import { useEffect, useId, useState } from 'react'

interface MermaidDiagramProps {
  source: string
  /** Incomplete fences throw while the model is still writing. */
  streaming?: boolean
}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let renderSeq = 0

function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'IBM Plex Sans, ui-sans-serif, system-ui, sans-serif'
      })
      return mod.default
    })
  }
  return mermaidReady
}

function MermaidFallback({
  source,
  error
}: {
  source: string
  error?: string
}): React.JSX.Element {
  return (
    <div className="mermaid-fallback">
      {error ? <p className="mermaid-fallback-error">{error}</p> : null}
      <pre>
        <code>{source}</code>
      </pre>
    </div>
  )
}

export function MermaidDiagram({
  source,
  streaming
}: MermaidDiagramProps): React.JSX.Element {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const text = source.trim()
    if (!text) {
      setSvg(null)
      setError(null)
      return
    }

    let cancelled = false
    const delay = streaming ? 280 : 0
    const timer = window.setTimeout(() => {
      void (async () => {
        const id = `mmd${reactId}${++renderSeq}`
        try {
          const mermaid = await getMermaid()
          const { svg: rendered } = await mermaid.render(id, text)
          if (!cancelled) {
            setSvg(rendered)
            setError(null)
          }
        } catch (err) {
          document.getElementById(`d${id}`)?.remove()
          if (cancelled) return
          setSvg(null)
          if (streaming) {
            setError(null)
            return
          }
          const message = err instanceof Error ? err.message : 'Invalid diagram'
          setError(message.split('\n')[0] ?? 'Invalid diagram')
        }
      })()
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [reactId, source, streaming])

  if (svg) {
    return (
      <div
        className="mermaid-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  if (error) {
    return <MermaidFallback source={source} error="Couldn’t render Mermaid diagram" />
  }

  if (streaming) {
    return <MermaidFallback source={source} />
  }

  return (
    <div className="mermaid-diagram mermaid-diagram-pending" aria-hidden>
      Rendering diagram…
    </div>
  )
}
