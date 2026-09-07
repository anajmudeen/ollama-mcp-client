import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ChatSession,
  ScheduleDelivery,
  ScheduleRecurrence,
  TelegramSchedule
} from '../../../shared/types'

type Draft = {
  id?: string
  name: string
  prompt: string
  enabled: boolean
  recurrenceType: 'interval' | 'cron'
  everyMinutes: number
  cronExpression: string
  deliveryMode: ScheduleDelivery['mode']
  notificationChannel: 'system' | 'in-app'
  sessionId: string | null
}

function emptyDraft(): Draft {
  return {
    name: '',
    prompt: '',
    enabled: true,
    recurrenceType: 'interval',
    everyMinutes: 60,
    cronExpression: '0 9 * * *',
    deliveryMode: 'telegram',
    notificationChannel: 'system',
    sessionId: null
  }
}

function draftToSchedule(draft: Draft): Omit<
  TelegramSchedule,
  'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunError'
> {
  const recurrence: ScheduleRecurrence =
    draft.recurrenceType === 'interval'
      ? { type: 'interval', everyMinutes: draft.everyMinutes }
      : { type: 'cron', expression: draft.cronExpression }

  let delivery: ScheduleDelivery
  if (draft.deliveryMode === 'telegram') {
    delivery = { mode: 'telegram' }
  } else if (draft.deliveryMode === 'notification') {
    delivery = { mode: 'notification', channel: draft.notificationChannel }
  } else {
    delivery = { mode: 'both', notificationChannel: draft.notificationChannel }
  }

  return {
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    enabled: draft.enabled,
    recurrence,
    delivery,
    sessionId: draft.sessionId
  }
}

function scheduleToDraft(schedule: TelegramSchedule): Draft {
  return {
    id: schedule.id,
    name: schedule.name,
    prompt: schedule.prompt,
    enabled: schedule.enabled,
    recurrenceType: schedule.recurrence.type,
    everyMinutes:
      schedule.recurrence.type === 'interval' ? schedule.recurrence.everyMinutes : 60,
    cronExpression:
      schedule.recurrence.type === 'cron' ? schedule.recurrence.expression : '0 9 * * *',
    deliveryMode: schedule.delivery.mode,
    notificationChannel:
      schedule.delivery.mode === 'notification'
        ? schedule.delivery.channel
        : schedule.delivery.mode === 'both'
          ? schedule.delivery.notificationChannel
          : 'system',
    sessionId: schedule.sessionId
  }
}

function recurrenceLabel(schedule: TelegramSchedule): string {
  if (schedule.recurrence.type === 'interval') {
    return `Every ${schedule.recurrence.everyMinutes} min`
  }
  return schedule.recurrence.expression
}

function deliveryLabel(schedule: TelegramSchedule): string {
  if (schedule.delivery.mode === 'telegram') return 'Telegram'
  if (schedule.delivery.mode === 'notification') {
    return schedule.delivery.channel === 'system' ? 'Notification (OS)' : 'Notification (in-app)'
  }
  return `Telegram + ${schedule.delivery.notificationChannel === 'system' ? 'OS' : 'in-app'}`
}

export function SchedulesPage({
  active,
  sessions
}: {
  active: boolean
  sessions: ChatSession[]
}): React.JSX.Element {
  const [schedules, setSchedules] = useState<TelegramSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSchedules(await window.api.schedules.list())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  useEffect(() => {
    const unsub = window.api.schedules.onChanged((next) => {
      setSchedules(next)
    })
    return unsub
  }, [])

  const sessionOptions = useMemo(() => {
    return sessions.filter((s) =>
      draft?.deliveryMode === 'notification'
        ? (s.origin ?? 'desktop') === 'desktop'
        : (s.origin ?? 'desktop') === 'telegram'
    )
  }, [sessions, draft?.deliveryMode])

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim() || !draft.prompt.trim()) {
      setError('Name and prompt are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = draftToSchedule(draft)
      if (draft.id) {
        const existing = schedules.find((s) => s.id === draft.id)
        if (existing) {
          await window.api.schedules.update({
            ...existing,
            ...payload,
            updatedAt: new Date().toISOString()
          })
        }
      } else {
        await window.api.schedules.create(payload)
      }
      setDraft(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const runNow = async (id: string): Promise<void> => {
    setRunningId(id)
    setError(null)
    try {
      const result = await window.api.schedules.runNow(id)
      if (!result.ok) setError(result.error ?? 'Run failed.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunningId(null)
    }
  }

  const toggleEnabled = async (schedule: TelegramSchedule): Promise<void> => {
    await window.api.schedules.update({
      ...schedule,
      enabled: !schedule.enabled
    })
    await refresh()
  }

  const remove = async (id: string): Promise<void> => {
    await window.api.schedules.delete(id)
    await refresh()
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0f1419]">
      <header className="titlebar-drag titlebar-overlay-pad border-b border-[#243041] px-6 py-4">
        <h1 className="text-lg font-semibold text-[#f0f4f8]">Schedules</h1>
        <p className="mt-1 text-sm text-[#8b9aab]">
          Run the agent on a timer. Results go to Telegram, desktop notifications, or both.
          Schedules only run while this app is open.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <p className="mb-3 rounded border border-rose-900/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(emptyDraft())}
            className="rounded-lg bg-[#2d6cb5] px-3 py-2 text-sm font-medium text-white hover:bg-[#3a7cc9]"
          >
            New schedule
          </button>
        </div>

        {draft && (
          <div className="mb-6 rounded-lg border border-[#2a3a4d] bg-[#121820] p-4">
            <h2 className="mb-3 text-sm font-medium text-[#e7ecf1]">
              {draft.id ? 'Edit schedule' : 'New schedule'}
            </h2>
            <label className="mb-2 block text-xs text-[#8b9aab]">Name</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm text-[#e7ecf1]"
            />
            <label className="mb-2 block text-xs text-[#8b9aab]">Prompt</label>
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={4}
              className="mb-3 w-full resize-y rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm text-[#e7ecf1]"
            />
            <label className="mb-2 block text-xs text-[#8b9aab]">Recurrence</label>
            <div className="mb-3 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-[#c5d0dc]">
                <input
                  type="radio"
                  checked={draft.recurrenceType === 'interval'}
                  onChange={() => setDraft({ ...draft, recurrenceType: 'interval' })}
                />
                Interval
              </label>
              <label className="flex items-center gap-2 text-sm text-[#c5d0dc]">
                <input
                  type="radio"
                  checked={draft.recurrenceType === 'cron'}
                  onChange={() => setDraft({ ...draft, recurrenceType: 'cron' })}
                />
                Cron
              </label>
            </div>
            {draft.recurrenceType === 'interval' ? (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm text-[#8b9aab]">Every</span>
                <input
                  type="number"
                  min={1}
                  value={draft.everyMinutes}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      everyMinutes: Math.max(1, Number(e.target.value) || 1)
                    })
                  }
                  className="w-24 rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1 text-sm text-[#e7ecf1]"
                />
                <span className="text-sm text-[#8b9aab]">minutes</span>
              </div>
            ) : (
              <input
                value={draft.cronExpression}
                onChange={(e) => setDraft({ ...draft, cronExpression: e.target.value })}
                placeholder="0 9 * * *"
                className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm text-[#e7ecf1]"
              />
            )}
            <label className="mb-2 block text-xs text-[#8b9aab]">Delivery</label>
            <select
              value={draft.deliveryMode}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  deliveryMode: e.target.value as ScheduleDelivery['mode'],
                  sessionId: null
                })
              }
              className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm text-[#e7ecf1]"
            >
              <option value="telegram">Telegram only</option>
              <option value="notification">Notification only</option>
              <option value="both">Telegram + notification</option>
            </select>
            {draft.deliveryMode !== 'telegram' && (
              <select
                value={draft.notificationChannel}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    notificationChannel: e.target.value as 'system' | 'in-app'
                  })
                }
                className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm text-[#e7ecf1]"
              >
                <option value="system">System notification</option>
                <option value="in-app">In-app banner</option>
              </select>
            )}
            <label className="mb-2 block text-xs text-[#8b9aab]">
              Session (optional — default active session at run time)
            </label>
            <select
              value={draft.sessionId ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sessionId: e.target.value || null
                })
              }
              className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm text-[#e7ecf1]"
            >
              <option value="">Default</option>
              {sessionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.origin ?? 'desktop') === 'telegram' ? '📱 ' : ''}
                  {s.title}
                </option>
              ))}
            </select>
            <label className="mb-3 flex items-center gap-2 text-sm text-[#c5d0dc]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDraft()}
                className="rounded bg-[#2d6cb5] px-3 py-1.5 text-sm text-white hover:bg-[#3a7cc9] disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded border border-[#2a3a4d] px-3 py-1.5 text-sm text-[#c5d0dc]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#8b9aab]">Loading…</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-[#8b9aab]">No schedules yet.</p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="rounded-lg border border-[#2a3a4d] bg-[#121820] px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-[#e7ecf1]">
                      {schedule.enabled ? schedule.name : `${schedule.name} (paused)`}
                    </p>
                    <p className="mt-1 text-xs text-[#8b9aab]">
                      {recurrenceLabel(schedule)} · {deliveryLabel(schedule)}
                    </p>
                    {schedule.lastRunAt && (
                      <p className="mt-1 text-xs text-[#6b7a8c]">
                        Last run: {new Date(schedule.lastRunAt).toLocaleString()}
                        {schedule.lastRunStatus ? ` · ${schedule.lastRunStatus}` : ''}
                        {schedule.lastRunError ? ` — ${schedule.lastRunError}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={runningId === schedule.id}
                      onClick={() => void runNow(schedule.id)}
                      className="rounded border border-[#2a3a4d] px-2 py-1 text-xs text-[#9ec5f0] hover:bg-[#1a2430] disabled:opacity-50"
                    >
                      Run now
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleEnabled(schedule)}
                      className="rounded border border-[#2a3a4d] px-2 py-1 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
                    >
                      {schedule.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(scheduleToDraft(schedule))}
                      className="rounded border border-[#2a3a4d] px-2 py-1 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(schedule.id)}
                      className="rounded border border-[#4a3030] px-2 py-1 text-xs text-rose-300 hover:bg-[#2a1818]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
