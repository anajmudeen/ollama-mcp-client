/**
 * Library READMEs mix HTML wrappers (e.g. &lt;center&gt;) with markdown images.
 * CommonMark does not parse markdown inside HTML blocks, so convert those
 * images to &lt;img&gt; and normalize wrappers for safe HTML rendering.
 */
export function prepareLibraryReadme(source: string): string {
  let md = source.replace(/\r\n/g, '\n')

  md = md
    .replace(/<center\b[^>]*>/gi, '<div class="readme-center">')
    .replace(/<\/center>/gi, '</div>')

  // Markdown images inside HTML elements → real <img> tags
  md = md.replace(
    /<(div|p|span|td|th|li|a)(\s[^>]*)?>((?:(?!<\/\1>)[\s\S])*?)<\/\1>/gi,
    (_full, tag: string, attrs: string | undefined, inner: string) => {
      const next = inner.replace(
        /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (_m, alt: string, src: string) =>
          `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`
      )
      return `<${tag}${attrs ?? ''}>${next}</${tag}>`
    }
  )

  return md
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
