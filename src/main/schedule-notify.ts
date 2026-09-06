import { BrowserWindow, Notification } from 'electron'
import type { ScheduleNotificationPayload } from '../shared/types'

const NOTIFICATION_SNIPPET_CHARS = 200

export function snippetForNotification(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= NOTIFICATION_SNIPPET_CHARS) return trimmed
  return `${trimmed.slice(0, NOTIFICATION_SNIPPET_CHARS)}…`
}

export function sendSystemScheduleNotification(
  title: string,
  body: string
): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.show()
}

export function broadcastInAppScheduleNotification(
  payload: ScheduleNotificationPayload
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('schedules:notification', payload)
  }
}
