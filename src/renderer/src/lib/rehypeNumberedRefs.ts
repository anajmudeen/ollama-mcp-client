import type { Element, ElementContent, Root, Text } from 'hast'
import { visitParents } from 'unist-util-visit-parents'

type Ancestor = Root | Element

function textOf(node: Element | Text | Root | ElementContent): string {
  if (node.type === 'text') return node.value
  if (!('children' in node) || !node.children) return ''
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text' || child.type === 'element') {
      out += textOf(child)
    }
  }
  return out
}

function classList(node: Element): string[] {
  const raw = node.properties?.className
  if (Array.isArray(raw)) return raw.map(String)
  if (raw == null) return []
  return String(raw).split(/\s+/).filter(Boolean)
}

function isFootnoteList(node: Element, ancestors: Ancestor[]): boolean {
  if (ancestors.some((a) => a.type === 'element' && classList(a).includes('footnotes'))) {
    return true
  }
  return node.children.some((child) => {
    if (child.type !== 'element' || child.tagName !== 'li') return false
    const id = child.properties?.id
    return typeof id === 'string' && /(?:^|-)fn-/.test(id)
  })
}

function previousLabel(parent: Ancestor | undefined, ol: Element): string {
  if (!parent || !('children' in parent)) return ''
  const idx = parent.children.indexOf(ol)
  if (idx < 0) return ''
  let label = ''
  for (let i = idx - 1; i >= 0 && i >= idx - 4; i--) {
    const sib = parent.children[i]
    if (sib.type === 'text' && !sib.value.trim()) continue
    if (sib.type === 'element' || sib.type === 'text') {
      label = `${textOf(sib)} ${label}`
    }
  }
  return label
}

/**
 * Give Vancouver-style reference lists stable ids (`ref-1`, `ref-2`, …)
 * so numeric citations can jump to them.
 */
export function rehypeNumberedRefs() {
  return (tree: Root): undefined => {
    const ols: Array<{ node: Element; label: string }> = []
    visitParents(tree, 'element', (node, ancestors) => {
      if (node.tagName !== 'ol') return
      if (isFootnoteList(node, ancestors)) return
      ols.push({
        node,
        label: previousLabel(ancestors.at(-1), node)
      })
    })
    if (ols.length === 0) return

    const labeled = ols.filter((o) => /reference/i.test(o.label))
    const target = labeled.at(-1)?.node
    if (!target) return

    const start = Number(target.properties?.start) || 1
    let n = start
    for (const child of target.children) {
      if (child.type !== 'element' || child.tagName !== 'li') continue
      const existing = child.properties?.id
      if (typeof existing !== 'string' || !existing) {
        child.properties = { ...child.properties, id: `ref-${n}` }
      }
      n += 1
    }
  }
}
