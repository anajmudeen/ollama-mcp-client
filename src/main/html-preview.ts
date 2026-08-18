import { protocol } from 'electron'
import type {
  HtmlPreviewCreatePayload,
  HtmlPreviewCreateResult
} from '../shared/types'

export const HTML_PREVIEW_SCHEME = 'html-preview'

interface PreviewEntry {
  html: string
  allowScripts: boolean
  allowRemoteScripts: boolean
}

const previews = new Map<string, PreviewEntry>()

export function registerHtmlPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: HTML_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

export function registerHtmlPreviewProtocol(): void {
  protocol.handle(HTML_PREVIEW_SCHEME, (request) => handleHtmlPreviewRequest(request))
}

export function createHtmlPreview(
  payload: HtmlPreviewCreatePayload
): HtmlPreviewCreateResult {
  if (typeof payload?.html !== 'string') {
    throw new Error('htmlPreview:create requires html string')
  }
  const id = crypto.randomUUID()
  previews.set(id, {
    html: payload.html,
    allowScripts: Boolean(payload.allowScripts),
    allowRemoteScripts: Boolean(payload.allowRemoteScripts)
  })
  return { id, url: `${HTML_PREVIEW_SCHEME}://${id}/` }
}

export function destroyHtmlPreview(id: string): void {
  if (typeof id !== 'string' || !id) return
  previews.delete(id)
}

export function destroyAllHtmlPreviews(): void {
  previews.clear()
}

function guestCsp(entry: PreviewEntry): string {
  const script = !entry.allowScripts
    ? "'none'"
    : entry.allowRemoteScripts
      ? "'unsafe-inline' 'unsafe-eval' blob: http: https:"
      : "'unsafe-inline' 'unsafe-eval' blob:"
  const connect =
    entry.allowScripts && entry.allowRemoteScripts ? 'http: https:' : "'none'"
  return [
    "default-src 'none'",
    `script-src ${script}`,
    "style-src 'unsafe-inline'",
    'img-src data: http: https:',
    'font-src data: http: https:',
    'media-src data:',
    `connect-src ${connect}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

function handleHtmlPreviewRequest(request: Request): Response {
  let id = ''
  try {
    id = new URL(request.url).hostname
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const entry = previews.get(id)
  if (!entry) {
    return new Response('Not Found', { status: 404 })
  }
  return new Response(entry.html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': guestCsp(entry)
    }
  })
}
