import { useEffect, useState } from 'react'

interface DownloadImageButtonProps {
  src: string
  filename?: string
  className?: string
}

function extensionFromMime(mime: string): string {
  const raw = mime.replace(/^image\//i, '').toLowerCase()
  if (raw === 'jpeg') return 'jpg'
  if (raw.includes('svg')) return 'svg'
  return raw.split('+')[0] || 'png'
}

function defaultFilename(mime: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  return `ollama-image-${stamp}.${extensionFromMime(mime)}`
}

/** Build a Blob from a data URL without fetch (CSP connect-src blocks data:). */
function blobFromDataUrl(src: string): { blob: Blob; mime: string } | null {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(src)
  if (!match) return null
  const mime = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const data = match[3] ?? ''
  try {
    if (isBase64) {
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return { blob: new Blob([bytes], { type: mime }), mime }
    }
    const decoded = decodeURIComponent(data)
    return { blob: new Blob([decoded], { type: mime }), mime }
  } catch {
    return null
  }
}

function triggerDownload(url: string, name: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function DownloadImageButton({
  src,
  filename,
  className = ''
}: DownloadImageButtonProps): React.JSX.Element {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const id = window.setTimeout(() => setSaved(false), 1500)
    return () => window.clearTimeout(id)
  }, [saved])

  const onDownload = (): void => {
    const parsed = blobFromDataUrl(src)
    if (parsed) {
      const name = filename ?? defaultFilename(parsed.mime)
      const url = URL.createObjectURL(parsed.blob)
      triggerDownload(url, name)
      URL.revokeObjectURL(url)
      setSaved(true)
      return
    }

    // Non-data URLs (http/blob) — direct download attribute
    const mimeGuess =
      /^data:([^;,]+)/i.exec(src)?.[1] ??
      (src.toLowerCase().includes('.jpg') ? 'image/jpeg' : 'image/png')
    triggerDownload(src, filename ?? defaultFilename(mimeGuess))
    setSaved(true)
  }

  return (
    <button
      type="button"
      title={saved ? 'Downloaded' : 'Download image'}
      onClick={onDownload}
      className={`inline-flex items-center gap-1 rounded-md border border-[#2a3a4d] bg-[#0f1419]/85 px-1.5 py-0.5 text-[10px] text-[#8b9aab] backdrop-blur hover:border-[#3d5168] hover:text-[#e7ecf1] ${className}`}
    >
      {saved ? (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Saved
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M8 2.5v7.2M8 9.7 5.4 7.1M8 9.7l2.6-2.6M3.5 12.5h9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Download
        </>
      )}
    </button>
  )
}
