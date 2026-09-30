/**
 * remark-math (micromark-extension-math) only parses `$…$` / `$$…$$`.
 * Models often emit LaTeX-style `\(...\)` and `\[...\]`; rewrite before remark.
 */
export function convertLatexDelimiterMath(segment: string): string {
  return convertInlineLatexDelimiters(convertDisplayLatexDelimiters(segment))
}

function convertDisplayLatexDelimiters(segment: string): string {
  return segment.replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => {
    return `$$\n${body.trim()}\n$$`
  })
}

function convertInlineLatexDelimiters(segment: string): string {
  return segment.replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => {
    return `$${body.trim()}$`
  })
}
