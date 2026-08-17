/** Architecture max (e.g. llama.context_length = 131072) is not the live window. */

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n)
}

export function parseArchitectureContextMax(
  modelInfo?: Record<string, unknown> | null
): number | undefined {
  if (!modelInfo) return undefined
  for (const [key, value] of Object.entries(modelInfo)) {
    if (!/context_length$/i.test(key)) continue
    const n = positiveInt(value)
    if (n) return n
  }
  return undefined
}

export function parseNumCtx(
  parameters?: string | null,
  modelfile?: string | null
): number | undefined {
  const fromParams = parameters?.match(/num_ctx\s+(\d+)/i)
  if (fromParams) {
    const n = positiveInt(fromParams[1])
    if (n) return n
  }
  const fromFile = modelfile?.match(/parameter\s+num_ctx\s+(\d+)/i)
  if (fromFile) {
    const n = positiveInt(fromFile[1])
    if (n) return n
  }
  return undefined
}

/**
 * Ollama's actual window is PARAMETER num_ctx (or the server default),
 * not the model's trained maximum. Prefer num_ctx; cap by architecture max.
 */
export function parseContextLength(
  modelInfo?: Record<string, unknown> | null,
  parameters?: string | null,
  modelfile?: string | null,
  runningContext?: number | null
): number | undefined {
  const archMax = parseArchitectureContextMax(modelInfo)
  const numCtx = parseNumCtx(parameters, modelfile)
  const running = runningContext && runningContext > 0 ? runningContext : undefined
  const preferred = numCtx ?? running ?? archMax
  if (!preferred) return undefined
  if (archMax) return Math.min(preferred, archMax)
  return preferred
}
