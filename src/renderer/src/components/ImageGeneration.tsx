import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AvailableImageModel,
  ImageGalleryItem,
  ImageGenerationResult
} from '../../../shared/types'
import { CopyButton } from './CopyButton'
import { DownloadImageButton } from './DownloadImageButton'
import { ImageLightbox } from './ImageLightbox'

interface ImageGenerationProps {
  active: boolean
}

function imageSrc(item: ImageGalleryItem): string {
  return `data:${item.mime};base64,${item.imageBase64}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function modelLabel(model: AvailableImageModel): string {
  return `${model.provider === 'ollama' ? 'Ollama' : 'OpenAI'} · ${model.model}`
}

export function ImageGeneration({
  active
}: ImageGenerationProps): React.JSX.Element {
  const [models, setModels] = useState<AvailableImageModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AvailableImageModel | null>(null)
  const [prompt, setPrompt] = useState('')
  const [gallery, setGallery] = useState<ImageGalleryItem[]>([])
  const [selectedPreview, setSelectedPreview] = useState<ImageGalleryItem | null>(null)
  const [newestResult, setNewestResult] = useState<ImageGalleryItem | null>(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [modelLoadFailed, setModelLoadFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const loadToken = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const token = ++loadToken.current
    setError(null)
    setDiscoveryLoading(true)
    setModelLoadFailed(false)
    const [modelsResult, galleryResult] = await Promise.allSettled([
      window.api.images.listAvailableModels(),
      window.api.images.listGallery()
    ])

    const errors: string[] = []
    if (modelsResult.status === 'fulfilled') {
      if (token !== loadToken.current) return
      const available = modelsResult.value.models
      setModels(available)
      if (!modelsResult.value.ok && available.length === 0) {
        setModelLoadFailed(true)
        const detail = modelsResult.value.error
        errors.push(
          detail ? `Ollama is unreachable: ${detail}` : 'Ollama is unreachable.'
        )
      }
      setSelectedModel((current) => {
        if (
          current &&
          available.some(
            (model) =>
              model.provider === current.provider && model.model === current.model
          )
        ) {
          return current
        }
        return available[0] ?? null
      })
    } else {
      if (token !== loadToken.current) return
      setModelLoadFailed(true)
      errors.push('Unable to load image models.')
    }
    if (token === loadToken.current) setDiscoveryLoading(false)

    if (galleryResult.status === 'fulfilled') {
      if (token !== loadToken.current) return
      setGallery(galleryResult.value)
      setNewestResult(galleryResult.value[0] ?? null)
      setSelectedPreview((current) => {
        if (!current) return galleryResult.value[0] ?? null
        return galleryResult.value.find((item) => item.id === current.id) ?? null
      })
    } else {
      if (token !== loadToken.current) return
      errors.push('Unable to load image gallery.')
    }

    if (token === loadToken.current && errors.length) setError(errors.join(' '))
  }, [])

  useEffect(() => {
    if (!active) return
    void load()
    return () => {
      loadToken.current += 1
    }
  }, [active, load])

  const previewImages = useMemo(
    () => gallery.map((item) => imageSrc(item)),
    [gallery]
  )
  const previewIndex = selectedPreview
    ? gallery.findIndex((item) => item.id === selectedPreview.id)
    : -1
  const newest = newestResult ?? gallery[0] ?? null

  const generate = async (): Promise<void> => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setError('Enter a prompt before generating an image.')
      return
    }
    if (!selectedModel) {
      setError('No image model is available. Set up an image model first.')
      return
    }

    setLoading(true)
    setError(null)
    setPersistenceWarning(null)
    try {
      const result: ImageGenerationResult = await window.api.images.generate({
        provider: selectedModel.provider,
        model: selectedModel.model,
        prompt: trimmedPrompt
      })
      if (!result.ok) {
        setError(result.message)
        return
      }

      const item = result.galleryItem
      if (!item && !result.persistenceError) {
        setError('The image was generated but could not be added to the gallery.')
        return
      }
      const previewItem: ImageGalleryItem = item ?? {
        id: `unsaved-${Date.now()}`,
        imageBase64: result.imageBase64,
        mime: result.mime,
        prompt: trimmedPrompt,
        provider: result.provider,
        model: result.model,
        createdAt: new Date().toISOString()
      }
      if (item) {
        setGallery((current) => [
          item,
          ...current.filter((entry) => entry.id !== item.id)
        ])
      }
      setNewestResult(previewItem)
      setSelectedPreview(previewItem)
      if (result.persistenceError) setPersistenceWarning(result.persistenceError)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image generation failed.')
    } finally {
      setLoading(false)
    }
  }

  const deleteItem = async (item: ImageGalleryItem): Promise<void> => {
    try {
      const deleted = await window.api.images.deleteGalleryItem(item.id)
      if (!deleted) {
        setError('That image was already removed.')
        return
      }
      setGallery((current) => {
        const next = current.filter((entry) => entry.id !== item.id)
        setNewestResult((newestItem) =>
          newestItem?.id === item.id ? next[0] ?? null : newestItem
        )
        setSelectedPreview((preview) =>
          preview?.id === item.id ? next[0] ?? null : preview
        )
        return next
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete image.')
    }
  }

  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[#0f1419] px-6 py-6"
      aria-hidden={!active}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6f8193]">
            Image studio
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#f0f4f8]">Create an image</h1>
        </header>

        {error && (
          <div
            className="rounded-lg border border-[#8f4650]/60 bg-[#3a2026] px-4 py-3 text-sm text-[#f0b8bf]"
            role="alert"
          >
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-3 underline underline-offset-2 hover:text-white"
            >
              Retry
            </button>
          </div>
        )}

        {discoveryLoading ? (
          <section className="rounded-xl border border-[#2a3a4d] bg-[#121820] p-6">
            <p className="text-sm text-[#8b9aab]" role="status">
              Discovering available image models…
            </p>
          </section>
        ) : modelLoadFailed && models.length === 0 ? (
          <section
            className="rounded-xl border border-[#8f4650]/60 bg-[#3a2026] p-6"
            role="alert"
          >
            <h2 className="text-base font-medium text-[#f0b8bf]">
              Image model discovery failed
            </h2>
            <p className="mt-2 max-w-xl text-sm text-[#d9aeb4]">
              We could not check for available image models. Retry discovery, or set up
              an Ollama/OpenAI image model before generating.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-md border border-[#b96470] bg-[#512a32] px-3 py-2 text-sm text-[#ffd7dc] hover:bg-[#67343e]"
            >
              Retry model discovery
            </button>
          </section>
        ) : models.length === 0 ? (
          <section className="rounded-xl border border-[#2a3a4d] bg-[#121820] p-6">
            <h2 className="text-base font-medium text-[#e7ecf1]">Set up an image model</h2>
            <p className="mt-2 max-w-xl text-sm text-[#8b9aab]">
              No available Ollama or OpenAI image models were found. Install or enable an
              image-capable model, then retry.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-md border border-[#2d6cb5] bg-[#1a3050] px-3 py-2 text-sm text-[#b8d5f3] hover:bg-[#234266]"
            >
              Retry model discovery
            </button>
          </section>
        ) : (
          <section className="grid min-h-[25rem] grid-cols-1 gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(24rem,1.6fr)]">
            <div className="rounded-xl border border-[#2a3a4d] bg-[#121820] p-5">
              <label
                htmlFor="image-model"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6f8193]"
              >
                Image model
              </label>
              <select
                id="image-model"
                value={selectedModel ? `${selectedModel.provider}:${selectedModel.model}` : ''}
                onChange={(event) => {
                  const next = models.find(
                    (model) => `${model.provider}:${model.model}` === event.target.value
                  )
                  setSelectedModel(next ?? null)
                }}
                className="mt-2 w-full rounded-md border border-[#2a3a4d] bg-[#0f1419] px-3 py-2 text-sm text-[#e7ecf1] outline-none focus:border-[#4b88c7]"
              >
                {models.map((model) => (
                  <option key={`${model.provider}:${model.model}`} value={`${model.provider}:${model.model}`}>
                    {modelLabel(model)}
                  </option>
                ))}
              </select>

              <label
                htmlFor="image-prompt"
                className="mt-5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[#6f8193]"
              >
                Prompt
              </label>
              <textarea
                id="image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the image you want to create..."
                rows={8}
                className="mt-2 w-full resize-y rounded-md border border-[#2a3a4d] bg-[#0f1419] px-3 py-2 text-sm leading-6 text-[#e7ecf1] outline-none placeholder:text-[#526272] focus:border-[#4b88c7]"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void generate()}
                className="mt-4 w-full rounded-md bg-[#2d6cb5] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3b7fc9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Generating…' : 'Generate'}
              </button>
            </div>

            <div className="flex min-h-[25rem] items-center justify-center overflow-hidden rounded-xl border border-[#2a3a4d] bg-[#0b1015]">
              {newest ? (
                <button
                  type="button"
                  onClick={() => setSelectedPreview(newest)}
                  className="group relative h-full min-h-[25rem] w-full"
                  title="Preview image"
                >
                  <img
                    src={imageSrc(newest)}
                    alt={newest.prompt}
                    className="h-full max-h-[34rem] w-full object-contain"
                  />
                  <span className="absolute bottom-3 left-3 rounded bg-[#0b1015]/80 px-2 py-1 text-xs text-[#c5d0dc] opacity-0 transition group-hover:opacity-100">
                    Preview
                  </span>
                </button>
              ) : (
                <p className="px-6 text-center text-sm text-[#6f8193]">
                  Your newest generated image will appear here.
                </p>
              )}
            </div>
          </section>
        )}

        {persistenceWarning && (
          <p className="rounded-lg border border-[#80682d]/60 bg-[#332b19] px-4 py-3 text-sm text-[#e4c878]">
            Image generated, but it was not saved to the gallery: {persistenceWarning}
          </p>
        )}

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium text-[#e7ecf1]">Gallery</h2>
            <span className="font-mono text-xs text-[#6f8193]">{gallery.length} images</span>
          </div>
          {gallery.length === 0 ? (
            <p className="mt-3 text-sm text-[#6f8193]">Generated images will be saved here.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {gallery.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-lg border border-[#2a3a4d] bg-[#121820]">
                  <button
                    type="button"
                    onClick={() => setSelectedPreview(item)}
                    className="block aspect-square w-full bg-[#0b1015]"
                    title="Preview image"
                  >
                    <img src={imageSrc(item)} alt={item.prompt} className="h-full w-full object-cover" />
                  </button>
                  <div className="p-2">
                    <p className="line-clamp-2 min-h-8 text-xs text-[#c5d0dc]" title={item.prompt}>
                      {item.prompt}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-[#6f8193]">
                      {item.provider} · {formatDate(item.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <DownloadImageButton
                        src={imageSrc(item)}
                      />
                      <CopyButton text={item.prompt} label="Copy prompt" />
                      <button
                        type="button"
                        onClick={() => void deleteItem(item)}
                        className="rounded-md border border-[#2a3a4d] px-1.5 py-0.5 text-[10px] text-[#8b9aab] hover:border-[#8f4650] hover:text-[#f0b8bf]"
                        title="Delete image"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {previewIndex >= 0 && (
        <ImageLightbox
          images={previewImages}
          index={previewIndex}
          onClose={() => setSelectedPreview(null)}
          onIndexChange={(index) => setSelectedPreview(gallery[index] ?? null)}
        />
      )}
    </main>
  )
}
