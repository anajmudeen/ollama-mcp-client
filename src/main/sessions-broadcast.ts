import { BrowserWindow } from 'electron'
import { getSessionsState } from './config-store'

export function broadcastSessionsChanged(): void {
  const state = getSessionsState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sessions:changed', state)
  }
}
