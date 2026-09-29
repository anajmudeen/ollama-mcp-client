import { BrowserWindow } from 'electron'
import { getSessionsListState } from './config-store'

export function broadcastSessionsChanged(): void {
  const state = getSessionsListState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sessions:changed', state)
  }
}
