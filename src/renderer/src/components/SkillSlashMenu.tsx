import type { AgentSkill } from '../../../shared/types'

const PREVIEW_COUNT = 8

export { PREVIEW_COUNT as SLASH_PREVIEW_COUNT }

interface SkillSlashMenuProps {
  skills: AgentSkill[]
  activeIndex: number
  expanded: boolean
  onHover: (index: number) => void
  onSelect: (skill: AgentSkill) => void
  onShowMore: () => void
}

export function SkillSlashMenu({
  skills,
  activeIndex,
  expanded,
  onHover,
  onSelect,
  onShowMore
}: SkillSlashMenuProps): React.JSX.Element | null {
  if (skills.length === 0) return null

  const hidden = expanded ? 0 : Math.max(0, skills.length - PREVIEW_COUNT)
  const visible = hidden > 0 ? skills.slice(0, PREVIEW_COUNT) : skills

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[#2a3a4d] bg-[#1a1f26] py-1.5 shadow-2xl"
      role="listbox"
    >
      <div className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-[#6b7a8c]">
        Skills
      </div>
      <ul className="max-h-72 overflow-y-auto">
        {visible.map((skill, index) => {
          const active = index === activeIndex
          return (
            <li key={skill.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(skill)
                }}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${
                  active ? 'bg-[#2a313a]' : 'hover:bg-[#222830]'
                }`}
              >
                <span className="truncate text-[13px] font-medium text-[#f0f4f8]">
                  /{skill.name}
                </span>
                <span className="truncate text-[12px] text-[#8b9aab]">
                  {skill.description || 'No description'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            onShowMore()
          }}
          className="w-full px-3 py-1.5 text-left text-[12px] text-[#8b9aab] hover:text-[#e7ecf1]"
        >
          Show {hidden} more
        </button>
      ) : null}
    </div>
  )
}
