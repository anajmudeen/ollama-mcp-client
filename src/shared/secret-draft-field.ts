/** Hide masks the draft; Show reveals plaintext. */
export function secretDraftInputType(revealed: boolean): 'text' | 'password' {
  return revealed ? 'text' : 'password'
}

export const CONFIGURED_SECRET_PLACEHOLDER = 'Configured key is hidden'

/** Write-only clear: only overwrite the stored secret when the draft is non-empty. */
export function nonEmptySecretDraft(draft: string): string | null {
  const trimmed = draft.trim()
  return trimmed.length > 0 ? trimmed : null
}
