import cron, { type ScheduledTask } from 'node-cron'
import type { TelegramSchedule } from '../shared/types'
import { listSchedules } from './config-store'
import { executeSchedule } from './schedule-executor'

const intervalTimers = new Map<string, ReturnType<typeof setInterval>>()
const cronJobs = new Map<string, ScheduledTask>()

const MIN_INTERVAL_MINUTES = 1

function clearScheduleTimer(id: string): void {
  const interval = intervalTimers.get(id)
  if (interval != null) {
    clearInterval(interval)
    intervalTimers.delete(id)
  }
  const job = cronJobs.get(id)
  if (job) {
    job.stop()
    cronJobs.delete(id)
  }
}

function registerSchedule(schedule: TelegramSchedule): void {
  clearScheduleTimer(schedule.id)
  if (!schedule.enabled) return

  if (schedule.recurrence.type === 'interval') {
    const minutes = Math.max(MIN_INTERVAL_MINUTES, schedule.recurrence.everyMinutes)
    const ms = minutes * 60 * 1000
    const timer = setInterval(() => {
      void executeSchedule(schedule.id)
    }, ms)
    intervalTimers.set(schedule.id, timer)
    return
  }

  const expression = schedule.recurrence.expression.trim()
  if (!cron.validate(expression)) {
    console.warn(`[schedules] invalid cron for ${schedule.id}: ${expression}`)
    return
  }

  const job = cron.schedule(
    expression,
    () => {
      void executeSchedule(schedule.id)
    },
    {
      timezone: schedule.recurrence.timezone || undefined
    }
  )
  cronJobs.set(schedule.id, job)
}

export function reloadScheduleRunner(): void {
  for (const id of [...intervalTimers.keys(), ...cronJobs.keys()]) {
    clearScheduleTimer(id)
  }
  for (const schedule of listSchedules()) {
    registerSchedule(schedule)
  }
}

export function stopScheduleRunner(): void {
  for (const id of [...intervalTimers.keys(), ...cronJobs.keys()]) {
    clearScheduleTimer(id)
  }
}

export function runScheduleNow(id: string): Promise<{ ok: boolean; error?: string }> {
  return executeSchedule(id, { manual: true })
}
