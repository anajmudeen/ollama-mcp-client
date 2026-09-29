import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { UiMessage } from '../shared/types'

export const SESSION_IMG_SCHEME = 'session-img'

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
const REF_RE = /^session-img:\/\/([0-9a-fA-F-]{36})\/?$/

/** Size floor so tiny non-image strings are not treated as inline images. */
const MIN_INLINE_BASE64_LEN = 64

let imagesRootOverride: string | null = null

export function setSessionImagesRootForTests(root: string | null): void {
  imagesRootOverride = root
}

function electronAppUserData(): string {
  // Lazy require so unit tests can SSR-load this module without electron named exports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as { app: { getPath: (name: string) => string } }
  return electron.app.getPath('userData')
}

export function sessionImagesRoot(): string {
  if (imagesRootOverride) return imagesRootOverride
  return join(electronAppUserData(), 'session-images')
}

function ensureRoot(): string {
  const root = sessionImagesRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function extForMime(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function mimeForExt(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

export function isSessionImageRef(value: string): boolean {
  return REF_RE.test(value)
}

export function sessionImageRef(fileId: string): string {
  return `${SESSION_IMG_SCHEME}://${fileId}`
}

export function parseSessionImageRef(value: string): string | null {
  const match = value.match(REF_RE)
  return match?.[1] ?? null
}

function findFileForId(fileId: string): string | null {
  const root = sessionImagesRoot()
  if (!existsSync(root)) return null
  const needle = `_${fileId}.`
  for (const name of readdirSync(root)) {
    if (name.includes(needle)) return join(root, name)
  }
  return null
}

function resolveFilePath(sessionId: string, fileId: string, ext: string): string {
  return join(ensureRoot(), `${sessionId}_${fileId}.${ext}`)
}

function parseInlineImage(
  value: string
): { mime: string; base64: string } | null {
  if (isSessionImageRef(value)) return null
  const dataMatch = value.match(DATA_URL_RE)
  if (dataMatch) {
    const mime = dataMatch[1]!
    const base64 = dataMatch[2]!.replace(/\s/g, '')
    if (base64.length < MIN_INLINE_BASE64_LEN) return null
    return { mime, base64 }
  }
  if (value.length >= MIN_INLINE_BASE64_LEN && /^[A-Za-z0-9+/=\s]+$/.test(value)) {
    return { mime: 'image/png', base64: value.replace(/\s/g, '') }
  }
  return null
}

export function uiMessagesHaveInlineImages(uiMessages: UiMessage[]): boolean {
  for (const msg of uiMessages) {
    if (!('images' in msg) || !msg.images?.length) continue
    for (const img of msg.images) {
      if (parseInlineImage(img)) return true
    }
  }
  return false
}

export function writeSessionImage(
  sessionId: string,
  mime: string,
  base64: string,
  fileId: string = randomUUID()
): string {
  const ext = extForMime(mime)
  const path = resolveFilePath(sessionId, fileId, ext)
  writeFileSync(path, Buffer.from(base64, 'base64'))
  return sessionImageRef(fileId)
}

function externalizeImageValue(sessionId: string, value: string): string {
  if (isSessionImageRef(value)) return value
  const parsed = parseInlineImage(value)
  if (!parsed) return value
  return writeSessionImage(sessionId, parsed.mime, parsed.base64)
}

/**
 * Replace inline image payloads in uiMessages with session-img:// refs.
 * Returns a new array when any message changed; otherwise the original array.
 */
export function externalizeUiMessageImages(
  sessionId: string,
  uiMessages: UiMessage[]
): { messages: UiMessage[]; changed: boolean } {
  let changed = false
  const messages = uiMessages.map((msg) => {
    if (!('images' in msg) || !msg.images?.length) return msg
    let msgChanged = false
    const images = msg.images.map((img) => {
      const next = externalizeImageValue(sessionId, img)
      if (next !== img) msgChanged = true
      return next
    })
    if (!msgChanged) return msg
    changed = true
    return { ...msg, images }
  })
  return { messages: changed ? messages : uiMessages, changed }
}

export function deleteSessionImages(sessionId: string): void {
  const root = sessionImagesRoot()
  if (!existsSync(root)) return
  const prefix = `${sessionId}_`
  for (const name of readdirSync(root)) {
    if (!name.startsWith(prefix)) continue
    try {
      unlinkSync(join(root, name))
    } catch {
      // Best-effort cleanup
    }
  }
}

export const SESSION_IMG_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true
} as const

/** @deprecated Prefer combined registerAppSchemes in index.ts */
export function registerSessionImgScheme(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { protocol } = require('electron') as {
    protocol: {
      registerSchemesAsPrivileged: (schemes: unknown[]) => void
    }
  }
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SESSION_IMG_SCHEME,
      privileges: { ...SESSION_IMG_SCHEME_PRIVILEGES }
    }
  ])
}

export function registerSessionImgProtocol(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { protocol } = require('electron') as {
    protocol: {
      handle: (scheme: string, handler: (request: Request) => Response) => void
    }
  }
  protocol.handle(SESSION_IMG_SCHEME, (request) => handleSessionImgRequest(request))
}

function handleSessionImgRequest(request: Request): Response {
  let parsed: URL
  try {
    parsed = new URL(request.url)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const fileId = parsed.hostname || parsed.pathname.replace(/^\//, '')
  if (!fileId || !/^[0-9a-fA-F-]{36}$/.test(fileId)) {
    return new Response('Not Found', { status: 404 })
  }
  const path = findFileForId(fileId)
  if (!path || !existsSync(path)) {
    return new Response('Not Found', { status: 404 })
  }
  try {
    const bytes = readFileSync(path)
    const ext = path.split('.').pop() ?? 'png'
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': mimeForExt(ext),
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff'
      }
    })
  } catch {
    return new Response('Not Found', { status: 404 })
  }
}
