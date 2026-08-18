import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentSkill, CatalogSkill } from '../../../shared/types'

interface Draft {
  id?: string
  name: string
  description: string
  body: string
}

export function SkillsPage({ active }: { active: boolean }): React.JSX.Element {
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tab, setTab] = useState<'mine' | 'catalog'>('mine')
  const [catalog, setCatalog] = useState<CatalogSkill[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogTried, setCatalogTried] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.skills.list()
      setSkills(list)
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

  const loadCatalog = useCallback(async (): Promise<void> => {
    setCatalogLoading(true)
    setError(null)
    try {
      const list = await window.api.skills.listCatalog()
      setCatalog(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCatalogTried(true)
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active && tab === 'catalog' && !catalogTried && !catalogLoading) {
      void loadCatalog()
    }
  }, [active, tab, catalogTried, catalogLoading, loadCatalog])

  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((s) => {
      const hay = `${s.name} ${s.description}`.toLowerCase()
      return hay.includes(q)
    })
  }, [catalog, catalogQuery])

  const addedNames = useMemo(
    () => new Set(skills.map((s) => s.name.trim().toLowerCase())),
    [skills]
  )

  const openNew = (): void => {
    setError(null)
    setDraft({ name: '', description: '', body: '' })
  }

  const openEdit = (skill: AgentSkill): void => {
    setError(null)
    setDraft({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body
    })
  }

  const handleSave = async (next: Draft): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await window.api.skills.upsert({
        id: next.id,
        name: next.name,
        description: next.description,
        body: next.body
      })
      setDraft(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (skill: AgentSkill, enabled: boolean): Promise<void> => {
    setBusyId(skill.id)
    setError(null)
    try {
      await window.api.skills.setEnabled(skill.id, enabled)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (skill: AgentSkill): Promise<void> => {
    if (!window.confirm(`Delete skill “${skill.name}”?`)) return
    setBusyId(skill.id)
    setError(null)
    try {
      await window.api.skills.delete(skill.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleAddCatalog = async (entry: CatalogSkill): Promise<void> => {
    setAddingId(entry.id)
    setError(null)
    try {
      await window.api.skills.addFromCatalog(entry.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingId(null)
    }
  }

  const enabledCount = skills.filter((s) => s.enabled).length

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="titlebar-drag titlebar-overlay-pad shrink-0 border-b border-[#243041] px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#f0f4f8]">Skills</h2>
            <p className="mt-0.5 text-sm text-[#8b9aab]">
              Local instruction packs, plus a catalog you can add from GitHub.
            </p>
          </div>
          <div className="titlebar-no-drag flex gap-1 rounded-lg border border-[#2a3a4d] bg-[#121820] p-0.5">
            <button
              type="button"
              onClick={() => setTab('mine')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                tab === 'mine'
                  ? 'bg-[#1a3050] text-[#9ec5f0]'
                  : 'text-[#8b9aab] hover:text-[#e7ecf1]'
              }`}
            >
              My skills
            </button>
            <button
              type="button"
              onClick={() => setTab('catalog')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                tab === 'catalog'
                  ? 'bg-[#1a3050] text-[#9ec5f0]'
                  : 'text-[#8b9aab] hover:text-[#e7ecf1]'
              }`}
            >
              Catalog
            </button>
          </div>
        </div>

        {tab === 'mine' ? (
          <div className="titlebar-no-drag mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#6b7a8c]">
              {skills.length} skill{skills.length === 1 ? '' : 's'} · {enabledCount}{' '}
              enabled
            </p>
            <button
              type="button"
              onClick={openNew}
              className="rounded-lg bg-[#2d6cb5] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3a7cc9]"
            >
              + New skill
            </button>
          </div>
        ) : (
          <div className="titlebar-no-drag mt-4 flex flex-wrap items-end justify-between gap-2">
            <input
              type="search"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder="Search catalog…"
              className="w-full max-w-md rounded-lg border border-[#2a3a4d] bg-[#0f1419] px-3 py-2 text-sm outline-none placeholder:text-[#5a6a7c] focus:border-[#4a7ab0]"
            />
            <div className="flex items-center gap-2">
              <p className="text-xs text-[#6b7a8c]">
                {filteredCatalog.length} of {catalog.length} from anthropics/skills
              </p>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                disabled={catalogLoading}
                className="rounded-lg border border-[#2a3a4d] px-3 py-1.5 text-xs text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {error ? (
          <p className="mb-3 rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {tab === 'mine' ? (
          loading ? (
            <p className="py-16 text-center text-sm text-[#8b9aab]">Loading…</p>
          ) : skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm text-[#8b9aab]">No skills yet.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTab('catalog')}
                  className="rounded-lg bg-[#2d6cb5] px-3 py-2 text-xs font-medium text-white hover:bg-[#3a7cc9]"
                >
                  Browse catalog
                </button>
                <button
                  type="button"
                  onClick={openNew}
                  className="rounded-lg border border-[#2a3a4d] px-3 py-2 text-xs text-[#c5d0dc] hover:bg-[#1a2430]"
                >
                  Create a skill
                </button>
              </div>
            </div>
          ) : (
            <ul className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {skills.map((skill) => {
                const busy = busyId === skill.id
                return (
                  <li
                    key={skill.id}
                    className="rounded-lg border border-[#2a3a4d] bg-[#161d27] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-[#f0f4f8]">
                          {skill.name}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-[#8b9aab]">
                          {skill.description || 'No description'}
                        </p>
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-xs text-[#c5d0dc]">
                        <input
                          type="checkbox"
                          checked={skill.enabled}
                          disabled={busy}
                          onChange={(e) =>
                            void handleToggle(skill, e.target.checked)
                          }
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(skill)}
                        disabled={busy}
                        className="rounded border border-[#2a3a4d] px-2.5 py-1 text-xs text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(skill)}
                        disabled={busy}
                        className="rounded border border-[#4a3030] px-2.5 py-1 text-xs text-rose-300 hover:bg-[#2a1818] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )
        ) : catalogLoading ? (
          <p className="py-16 text-center text-sm text-[#8b9aab]">
            Loading catalog…
          </p>
        ) : filteredCatalog.length === 0 ? (
          <p className="py-16 text-center text-sm text-[#8b9aab]">
            No matching skills.
          </p>
        ) : (
          <ul className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {filteredCatalog.map((entry) => {
              const added = addedNames.has(entry.name.trim().toLowerCase())
              const busy = addingId === entry.id
              return (
                <li
                  key={entry.id}
                  className="rounded-lg border border-[#2a3a4d] bg-[#161d27] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-[#f0f4f8]">
                        {entry.name}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-[#8b9aab]">
                        {entry.description || 'No description'}
                      </p>
                      <p className="mt-2 text-[10px] text-[#6b7a8c]">
                        {entry.source}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={added || busy}
                      onClick={() => void handleAddCatalog(entry)}
                      className={`shrink-0 rounded px-2.5 py-1 text-xs ${
                        added
                          ? 'border border-[#2a3a4d] text-[#6b7a8c]'
                          : 'border border-[#3d6a9a] bg-[#1a3050] text-[#9ec5f0] hover:bg-[#234068] disabled:opacity-70'
                      }`}
                    >
                      {added ? 'Added' : busy ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {draft ? (
        <SkillForm
          initial={draft}
          saving={saving}
          onCancel={() => {
            if (!saving) setDraft(null)
          }}
          onSave={(next) => void handleSave(next)}
        />
      ) : null}
    </main>
  )
}

function SkillForm({
  initial,
  saving,
  onCancel,
  onSave
}: {
  initial: Draft
  saving: boolean
  onCancel: () => void
  onSave: (draft: Draft) => void
}): React.JSX.Element {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [body, setBody] = useState(initial.body)

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || saving) return
    onSave({
      id: initial.id,
      name: name.trim(),
      description,
      body
    })
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-[#2a3a4d] bg-[#161d27] p-4 shadow-xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-[#f0f4f8]">
          {initial.id ? 'Edit skill' : 'New skill'}
        </h3>
        <label className="mb-1 block text-xs text-[#8b9aab]">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          required
          placeholder="pr-review"
          className="mb-3 w-full rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
          rows={2}
          placeholder="When to use this skill…"
          className="mb-3 w-full resize-y rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
        />
        <label className="mb-1 block text-xs text-[#8b9aab]">Instructions</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={saving}
          rows={12}
          placeholder="Markdown instructions the model should follow after load_skill."
          className="mb-4 min-h-[12rem] w-full flex-1 resize-y rounded border border-[#2a3a4d] bg-[#0f1419] px-2 py-1.5 font-mono text-sm outline-none focus:border-[#4a7ab0] disabled:opacity-60"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-[#2a3a4d] px-3 py-1.5 text-sm text-[#c5d0dc] hover:bg-[#1a2430] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded bg-[#2d6cb5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3a7cc9] disabled:opacity-70"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
