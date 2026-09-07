import { BrowserWindow } from 'electron'
import type { TelegramSchedule } from '../shared/types'
import { listSchedules } from './config-store'

export function broadcastSchedulesChanged(): void {
  const schedules = listSchedules()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('schedules:changed', schedules)
  }
}
