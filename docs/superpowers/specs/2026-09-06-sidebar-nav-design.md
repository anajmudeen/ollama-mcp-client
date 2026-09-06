# Sidebar navigation menu

Date: 2026-09-06

## Problem

Models, MCP, Skills, and Schedules are stacked as full-width bordered buttons under New chat. They consume vertical space and feel heavy compared to the session list.

## Goal

Replace the button stack with a compact **nav list** (icon + label rows) between the header and Sessions section. Include Chat and Settings in the same menu.

## Layout

```
Header (logo + New chat)
Navigation (Chat, Models, MCP Servers, Skills, Schedules, Settings)
Sessions (scrollable list)
```

Remove the footer Settings button.

## Nav items

| Item | Action | Active when |
| --- | --- | --- |
| Chat | `setView('chat')` | `view === 'chat'` |
| Models | `setView('models')` | `view === 'models'` |
| MCP Servers | `setView('mcp')` | `view === 'mcp'` |
| Skills | `setView('skills')` | `view === 'skills'` |
| Schedules | `setView('schedules')` | `view === 'schedules'` |
| Settings | Open Settings modal | `settingsOpen === true` |

Selecting a session still switches to chat view.

## Visual

- Section label: `NAVIGATION` (matches `SESSIONS` style)
- Row: icon + label, left-aligned, ~36px tall, rounded-lg
- Active: same highlight as active session (`bg-[#1a3050]`, blue ring)
- Inactive: muted text, hover background
- Inline SVG icons consistent with existing sidebar

## Implementation

- Refactor `Sidebar.tsx` with a `navItems` config array
- `App.tsx`: pass `settingsOpen`, unified `onNavigate(view)`; Settings nav calls `onOpenSettings`
- No routing changes; lazy page loading unchanged

## Non-goals

- Collapsible sidebar, icon-only rail, nav badges

## Manual test

1. Each nav item opens correct page; Chat returns to last session
2. Session click → chat view + Chat nav highlighted
3. Settings opens modal from nav
4. Active state tracks current view
