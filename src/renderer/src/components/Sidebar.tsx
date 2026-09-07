import type { ChatSession, ChatQueueState, SessionQueueStatus } from '../../../shared/types'
import appIcon from '../assets/icon-128.png'

type AppView = 'chat' | 'models' | 'mcp' | 'skills' | 'schedules' | 'settings'

function queueStatusForSession(
  sessionId: string,
  state: ChatQueueState
): SessionQueueStatus {
  if (state.running?.sessionId === sessionId) return 'running'
  if (state.queued.some((q) => q.sessionId === sessionId)) return 'queued'
  return 'idle'
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString()
}

const NAV_ACTIVE =
  'bg-[#1a3050] text-[#9ec5f0] ring-1 ring-[#2d6cb5]/40'
const NAV_IDLE = 'text-[#c5d0dc] hover:bg-[#1a2430]'

function NavIconChat(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9l-2.5 2v-2h-4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NavIconModels(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function NavIconMcp(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8h3M10 8h3M8 3v3M8 10v3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function NavIconSkills(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M3 8h7M3 12h10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function NavIconSchedules(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function NavIconSettings(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.5 2.5h3l.4 1.4a4.5 4.5 0 0 1 1.1.6l1.4-.5.1.2 1.5 2.6-.9 1.1c.1.4.1.7 0 1.1l.9 1.1-1.5 2.6-.1.2-1.4-.5a4.5 4.5 0 0 1-1.1.6L9.5 13.5h-3l-.4-1.4a4.5 4.5 0 0 1-1.1-.6l-1.4.5-.1-.2L1.9 9.2l.9-1.1a4.2 4.2 0 0 1 0-1.1l-.9-1.1L3.5 3.2l.1-.2 1.4.5c.3-.3.7-.5 1.1-.6L6.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

const VIEW_NAV: Array<{
  id: AppView
  label: string
  icon: () => React.JSX.Element
}> = [
  { id: 'chat', label: 'Chat', icon: NavIconChat },
  { id: 'models', label: 'Models', icon: NavIconModels },
  { id: 'mcp', label: 'MCP Servers', icon: NavIconMcp },
  { id: 'skills', label: 'Skills', icon: NavIconSkills },
  { id: 'schedules', label: 'Schedules', icon: NavIconSchedules },
  { id: 'settings', label: 'Settings', icon: NavIconSettings }
]

interface SidebarProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  queueState: ChatQueueState
  view: AppView
  onNewSession: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onNavigate: (view: AppView) => void
}

export function Sidebar({
  sessions,
  activeSessionId,
  queueState,
  view,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onNavigate
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#243041] bg-[#121820]">
      <div className="titlebar-drag titlebar-traffic-pad border-b border-[#243041] px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <img
            src={appIcon}
            alt=""
            width={44}
            height={44}
            draggable={false}
            className="h-11 w-11 shrink-0 rounded-[10px] shadow-sm shadow-black/30"
          />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-[#f0f4f8]">
              Ollama MCP
            </h1>
            <p className="mt-0.5 truncate text-xs text-[#8b9aab]">
              Local models + MCP tools
            </p>
          </div>
        </div>
      </div>

      <nav className="titlebar-no-drag border-b border-[#243041] px-2 py-2">
        <h2 className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#6b7a8c]">
          Navigation
        </h2>
        <ul className="space-y-0.5">
          {VIEW_NAV.map((item) => {
            const active = view === item.id
            const Icon = item.icon
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition ${
                    active ? NAV_ACTIVE : NAV_IDLE
                  }`}
                >
                  <span className="shrink-0 opacity-90">
                    <Icon />
                  </span>
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7a8c]">
            Sessions
          </h2>
          <button
            type="button"
            title="New chat"
            onClick={onNewSession}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2a3a4d] bg-[#0f1419] text-[#9ec5f0] transition hover:border-[#2d6cb5]/50 hover:bg-[#1a3050]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M8 3.5v9M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <ul className="space-y-0.5">
          {sessions.length === 0 && (
            <li className="px-2 py-3 text-xs text-[#6b7a8c]">No chats yet.</li>
          )}
          {sessions.map((session) => {
            const active = session.id === activeSessionId && view === 'chat'
            const qStatus = queueStatusForSession(session.id, queueState)
            return (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className={`flex w-full flex-col gap-1 rounded-lg px-2.5 py-2.5 text-left transition ${
                    active
                      ? 'bg-[#1a3050] text-[#9ec5f0] ring-1 ring-[#2d6cb5]/40'
                      : 'text-[#e7ecf1] hover:bg-[#1a2430]'
                  }`}
                >
                  <span className="line-clamp-2 pr-6 text-sm font-medium leading-snug">
                    {(session.origin ?? 'desktop') === 'telegram' ? '📱 ' : ''}
                    {session.title || 'New chat'}
                  </span>
                  <span
                    className={`flex items-center gap-1.5 text-[10px] ${active ? 'text-[#7aa4d4]' : 'text-[#6b7a8c]'}`}
                  >
                    {qStatus === 'running' && (
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400"
                        title="Running"
                      />
                    )}
                    {qStatus === 'queued' && (
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                        title="Queued"
                      />
                    )}
                    {formatRelativeTime(
                      session.uiMessages.at(-1)?.createdAt ??
                        session.updatedAt ??
                        session.createdAt
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  title="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession(session.id)
                  }}
                  className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded text-[#8b9aab] hover:bg-[#2a1818] hover:text-rose-300 group-hover:flex"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}
