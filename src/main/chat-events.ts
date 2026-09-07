import { BrowserWindow } from 'electron'
import type { ChatEvent } from '../shared/types'

type ChatEventListener = (event: ChatEvent) => void

const listeners = new Set<ChatEventListener>()

export function onChatEvent(listener: ChatEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitChatEvent(event: ChatEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error('[chat-events] listener error', err)
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chat:event', event)
  }
}
