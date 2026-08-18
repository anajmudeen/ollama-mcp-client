const HTML_FENCE_LANGS = new Set(['', 'html', 'htm', 'xml'])

const DOCUMENT_RE = /<!DOCTYPE\s+html|<html(?:\s|>|\/)/i
const SCRIPT_OR_CANVAS_RE = /<(?:script|canvas)[\s>]/i
const SCRIPT_SRC_QUOTED_RE = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']*)\1/gi
const SCRIPT_SRC_UNQUOTED_RE = /<script\b[^>]*\bsrc\s*=\s*([^\s>]+)/gi
const REMOTE_SRC_RE = /^(https?:)?\/\//i

export function isHtmlDocumentFence(language: string, source: string): boolean {
  const lang = language.trim().toLowerCase()
  if (!HTML_FENCE_LANGS.has(lang)) return false
  return DOCUMENT_RE.test(source)
}

export function htmlNeedsRun(source: string): boolean {
  return SCRIPT_OR_CANVAS_RE.test(source)
}

function srcIsRemote(src: string): boolean {
  return REMOTE_SRC_RE.test(src.trim())
}

export function htmlHasRemoteScripts(source: string): boolean {
  SCRIPT_SRC_QUOTED_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SCRIPT_SRC_QUOTED_RE.exec(source))) {
    if (srcIsRemote(match[2] ?? '')) return true
  }
  SCRIPT_SRC_UNQUOTED_RE.lastIndex = 0
  while ((match = SCRIPT_SRC_UNQUOTED_RE.exec(source))) {
    const raw = (match[1] ?? '').replace(/^["']|["']$/g, '')
    if (srcIsRemote(raw)) return true
  }
  return false
}
