# Image Generation Page Design

## Overview

Add a dedicated **Image** workspace beside Chat in the sidebar. The workspace lets users select an available image model, enter a prompt, generate an image, and manage a persistent gallery of generated images. Image generation remains independent of the active chat LLM, so it works consistently when Chat is using Ollama, OpenAI, or Azure OpenAI.

## Goals

- Provide a focused image-generation workflow outside Chat.
- List only image-capable Ollama and OpenAI models available through the existing image backend routing.
- Persist complete gallery items across application restarts.
- Keep generation state and errors isolated from Chat.
- Reuse existing main-process image generation and provider routing.

## User experience

### Navigation and layout

Add an `Image` item to the sidebar and an `image` application view. The page uses the approved **Studio split** layout:

- Left side: image-model selector, prompt input, and Generate button.
- Right side: a large preview of the newest successful result.
- Below the workspace: persistent gallery/history, optionally in a scrollable region or drawer when space is constrained.

The Image page does not show chat sessions or chat-model choices. Chat navigation and state remain unchanged when switching views.

### Models and prompt

When the page opens, load the available image models from the main process. The selector includes only image-capable models returned by the existing discovery and backend validation rules, grouped or labeled by provider where needed. If no models are available, show setup guidance rather than an unusable form.

The initial generation controls are intentionally limited to:

- Image model
- Prompt

The selected model and prompt remain intact after a failed request. A successful request clears neither automatically, allowing quick variations.

### Gallery actions

Each generated item stores and displays:

- Image data
- Original prompt
- Provider and model
- Creation timestamp

Gallery items support:

- Preview in the existing image lightbox or equivalent full-size viewer
- Download
- Copy prompt
- Delete

Deleting an item requires an explicit user action and removes it from persistent storage and the current view. No edit or regenerate action is included in this initial page.

## Architecture

### Renderer

- Extend the shared application-view union and sidebar navigation with `image`.
- Add a dedicated Image generation component rather than embedding the workflow in Chat.
- Keep selected model, prompt, loading state, current result, gallery records, and error state local to the Image view or an image-specific hook.
- Render the Image view from `App.tsx` without changing Chat's provider or session state.

### Main process and IPC

- Reuse `image-gen-tool.ts` discovery, backend resolution, and generation paths.
- Add renderer-facing IPC operations for:
  - Listing available image models
  - Generating an image with an explicitly selected provider/model
  - Loading persisted gallery items
  - Saving a successful gallery item
  - Deleting a gallery item
- Keep provider credentials and provider-specific request details in the main process.
- Ensure IPC validation rejects malformed model identifiers, gallery records, or deletion IDs.

### Persistence

Store gallery records in the existing application persistence mechanism used for configuration/state, with a versioned image-gallery collection. Persist image data in the format already returned by the image-generation pipeline so records can be rendered after restart.

The persistence layer must:

- Treat a missing gallery collection as an empty gallery.
- Preserve existing configuration migrations.
- Avoid exposing API keys or other secrets to the renderer.
- Handle malformed records defensively by ignoring or removing invalid entries rather than preventing the app from starting.

## Data flow

1. App opens the Image view.
2. Renderer requests available image models and persisted gallery items.
3. User selects a model and enters a prompt.
4. Renderer invokes image generation with the selected model.
5. Main process routes the request to the selected Ollama or OpenAI image backend.
6. On success, main process or the renderer-facing persistence operation saves the image, prompt, provider/model, and timestamp.
7. Renderer displays the new image as the large result and prepends it to gallery history.
8. On failure, renderer shows an inline error while preserving the form state.
9. Gallery actions update the preview, clipboard, download flow, or persistent collection as appropriate.

## Error and empty states

- No image models: explain how to configure or enable an Ollama/OpenAI image backend.
- Generation in progress: disable duplicate submission and show progress feedback.
- Generation failure: show a non-destructive inline error; retain prompt and model.
- Gallery load failure: show the workspace with an error state and allow retry.
- Persistence failure after generation: show the image result and clearly indicate that it was not saved.
- Invalid or unavailable selected model: refresh model discovery and ask the user to select another model.

## Testing

### Unit and integration coverage

- Image view is reachable from the sidebar and Chat remains reachable.
- Image model discovery filters out non-image models and unavailable/unvalidated providers.
- Generation sends the selected provider/model and prompt to the main process.
- Successful generation creates a gallery record with image, prompt, provider/model, and timestamp.
- Failed generation preserves the prompt and selected model and displays an error.
- Gallery records load after restart and malformed records do not crash startup.
- Delete removes the record from persistence and the rendered gallery.
- Preview, download, and copy-prompt actions use the selected gallery item.
- Switching between Chat and Image does not mutate chat sessions, active chat LLM state, or chat attachments.

## Scope boundaries

This design does not add image size/aspect-ratio controls, provider-specific advanced options, image editing, regeneration, or a feed-based history. Those can be evaluated separately after the core Image workspace is stable.
