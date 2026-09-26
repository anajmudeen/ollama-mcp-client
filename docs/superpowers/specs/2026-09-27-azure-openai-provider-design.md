# Azure OpenAI Provider

Date: 2026-09-27

## Goal

Add Azure OpenAI as a third LLM provider alongside Ollama and OpenAI. Users
can configure an Azure OpenAI API key, service endpoint, and API version,
validate the connection, view the resource's model catalog, manually add Azure
deployment names, enable deployments, and use them through the same agent flow
as OpenAI.

The existing OpenAI provider must continue to behave unchanged.

## Decisions

| Topic | Decision |
| --- | --- |
| Provider identity | Separate `azure-openai` provider |
| Configuration | API key, service endpoint, configurable API version |
| Default API version | `2024-10-21` |
| Validation and catalog | `GET {endpoint}/openai/models?api-version={version}` with `api-key` |
| Deployment discovery | Manual deployment-name entry by the user |
| Model management | Azure catalog plus manually managed deployments |
| New deployment state | Disabled by default |
| Selection | Independent selected model slot for each provider |
| Fallback | Runtime fallback to Ollama; preserve configured provider |
| Provider behavior | Reuse OpenAI conversion, streaming, tools, vision, and usage logic |
| Image backend | Independent selected OpenAI or Ollama image backend |
| Image generation | Chat provider is independent from image backend |
| Image editing | Supported only when the selected image backend is OpenAI |

Azure's models endpoint returns models available to the resource, not the
deployment names required by chat requests. Catalog model IDs may be used to
decorate deployment entries when they match, but the manually entered
deployment name is always used for requests.

## Configuration and persistence

Extend `LlmProvider` to:

```ts
type LlmProvider = 'ollama' | 'openai' | 'azure-openai'
```

Add Azure fields to `AppConfig` and the electron-store schema:

- `azureOpenaiEnabled: boolean`
- `azureOpenaiApiKey: string | null`
- `azureOpenaiEndpoint: string | null`
- `azureOpenaiApiVersion: string`
- `azureOpenaiValidationOk: boolean`
- `azureOpenaiValidationError: string | null`
- `azureOpenaiModelsCatalog: AzureOpenaiModelEntry[]`
- `azureOpenaiDeployments: AzureOpenaiDeploymentEntry[]`
- `imageBackend: { provider: 'openai' | 'ollama'; model: string } | null`

An Azure model entry stores the catalog ID, capability metadata, and creation
timestamp when present. An Azure deployment entry stores at minimum the
manually entered deployment name and its enabled state; matched catalog
metadata is optional and must not replace the deployment name.

Selected models remain provider-specific:

```ts
interface SelectedModelByProvider {
  ollama: string | null
  openai: string | null
  'azure-openai': string | null
}
```

Existing configurations migrate without changing their selected Ollama or
OpenAI model. Azure defaults to disabled, with no key, endpoint, catalog,
deployments, or selected model.

Refreshing the catalog preserves manually entered deployments and their
enabled state. A catalog refresh may update matched metadata, but must not
delete deployments when a model is absent from the catalog.

The existing `defaultImageModel: string | null` setting migrates to
`imageBackend` using the following rules:

- A model matching an enabled OpenAI image model becomes
  `{ provider: 'openai', model }`.
- Otherwise, a model matching an installed Ollama image model becomes
  `{ provider: 'ollama', model }`.
- An unresolvable legacy value becomes `null`.

The image backend is independent of the configured/effective chat provider.
There is exactly one selected image backend at a time and no automatic
fallback to the other backend.

## Settings and Models UI

The provider selector offers Ollama, OpenAI, and Azure OpenAI. The Azure
section contains:

- Enable Azure OpenAI toggle
- API key password field with show/hide control
- Service endpoint field
- API version field prefilled with `2024-10-21`
- Validate and fetch models action
- Validation status and error
- Link to Azure models management

The Azure Models page section displays the validated catalog and manually
managed deployments. Users can add a deployment name, remove it, enable or
disable it, and see matched model metadata when available. New entries are
disabled. Only enabled deployment names appear in the Azure chat model
selector.

The UI must distinguish model catalog entries from deployment entries. A
catalog model is not automatically a usable chat model until a deployment
with that name is added and enabled.

Settings also provides one combined image-backend selector grouped by
provider, with entries such as `OpenAI · gpt-image-1` and
`Ollama · flux`. Only currently available image models are listed. The
selection stores both provider and model, so model-name collisions cannot
route to the wrong backend.

## HTTP behavior

All Azure HTTP requests run in the Electron main process. The API key is
never sent to the renderer or written to logs.

Validation and catalog refresh:

```text
GET {normalizedEndpoint}/openai/models?api-version={encodedApiVersion}
api-key: {apiKey}
```

Chat completion:

```text
POST {normalizedEndpoint}/openai/deployments/{encodedDeployment}/chat/completions?api-version={encodedApiVersion}
api-key: {apiKey}
Content-Type: application/json
```

The request body follows the existing OpenAI Chat Completions format, using
the deployment name in the URL. Streaming uses SSE and includes usage where
the Azure API supports `stream_options.include_usage`.

The Azure provider reuses the existing OpenAI-compatible behavior for:

- Internal message conversion
- Tool definitions and streamed tool-call accumulation
- Base64 image data URLs for vision inputs
- Reasoning/tool request handling where supported
- Token usage parsing
- Non-streaming calls for titles and context compaction

Azure errors are normalized to the service error message and must not include
credentials. Missing endpoint, key, API version, or enabled deployment is a
configuration error rather than an HTTP request.

## Runtime provider resolution

The effective provider resolver supports all three configured providers:

1. Ollama resolves to Ollama.
2. OpenAI resolves to OpenAI only when enabled, keyed, validated, and usable.
3. Azure OpenAI resolves to Azure only when enabled, keyed, endpoint/API
   version configured, validated, and at least one enabled deployment exists.

If the configured cloud provider is unavailable, the resolver returns Ollama
with `fallback: true` and a user-facing reason. The stored provider selection
is not mutated. The agent emits the existing provider-fallback event once at
turn start.

Once a turn starts, provider errors are surfaced directly. The app does not
silently switch providers halfway through a turn.

The selected model is read from the effective provider's slot. If Azure is
configured but falls back to Ollama, the Ollama selection is used.

## Agent integration

The provider interface remains the common boundary for:

- Streaming chat
- One-shot chat
- Listing chat models
- Model information and capabilities
- Vision detection
- Context-length resolution
- Image-generation classification

`agent.ts`, session-title generation, context compaction, scheduled execution,
Telegram turns, and MCP tool loops use the effective provider abstraction.
Azure deployments are treated as chat models. The agent offers image tools to
any chat provider, including Azure, when the selected image backend is
available. Image tool execution routes to the selected image backend rather
than the chat provider:

- Ollama image backend: image generation uses the existing Ollama image API.
- OpenAI image backend: image generation and image editing use the existing
  OpenAI image APIs.
- Ollama image editing returns a clear unsupported-operation result.
- No image backend selected or available: image tools are not offered.

Azure itself does not need to implement image APIs. Its chat model receives
the tools and the selected OpenAI/Ollama backend performs the operation.

## IPC and preload

Add IPC operations for:

- Azure settings updates
- Azure validation and catalog refresh
- Azure deployment add/update/remove
- Azure deployment enabled-state updates
- Azure chat-model listing
- Effective provider resolution

`config:get` returns Azure configuration and status needed by the renderer,
with the API key masked or omitted. Existing OpenAI and Ollama IPC contracts
remain compatible.

## Error handling and edge cases

- Invalid validation preserves the previous catalog and deployment list.
- Endpoint trailing slashes are normalized before URL construction.
- API version and deployment path values are URL encoded.
- Duplicate deployment names are rejected or treated as an update, never
  rendered as duplicate selectable models.
- Removing a deployment clears the Azure selected model if it was selected.
- Disabling Azure preserves its key, catalog, deployments, and selection.
- No enabled deployments produces an actionable empty-state message.
- Azure tool-call errors are shown directly; they do not trigger mid-turn
  fallback.
- Catalog model capability metadata is advisory; deployment availability is
  determined by the user's deployment configuration.

## Security

- Azure credentials are stored only in the main-process electron-store.
- Renderer APIs expose configuration status but not the raw API key.
- API keys are never included in logs, error messages, IPC events, or
  persisted chat history.
- Azure endpoint and API version are treated as user input and safely encoded
  into request URLs.
- OpenAI and Azure credentials remain isolated from the Ollama image backend;
  image requests use only the credentials for the selected image provider.

## Testing and acceptance criteria

Automated or focused tests should cover:

1. Provider/config migration and Azure defaults.
2. Endpoint normalization and URL encoding.
3. Azure `api-key` headers and absence of Bearer authentication.
4. Model catalog parsing, capability mapping, and refresh preservation.
5. Manual deployment add/remove/enable behavior and duplicate handling.
6. Azure streaming content and tool-call SSE parsing.
7. Tool results, vision image conversion, and usage parsing.
8. Azure validation failure and runtime Ollama fallback.
9. Provider-specific model selection.
10. Independent image-backend selection and legacy image-model migration.
11. Azure chat with image tools routes to the selected OpenAI image backend.
12. Ollama image generation works through Azure/OpenAI/Ollama chat providers.
13. Ollama image editing returns a clear unsupported message.
14. Existing OpenAI behavior and `npm run typecheck`.

Manual acceptance:

1. Configure Azure settings and validate successfully.
2. Confirm the catalog appears, add a deployment manually, enable it, and
   confirm it appears in chat.
3. Send a streaming chat with an MCP tool.
4. Send a vision prompt to a compatible deployment.
5. Disable Azure or invalidate credentials and confirm Ollama fallback with a
   warning.
6. Switch among Ollama, OpenAI, and Azure and confirm each selected model is
   preserved independently.
7. Confirm titles, compaction, Telegram, and schedules use the resolved
   provider.
8. Select Azure as the chat provider and OpenAI or Ollama as the image
   backend; verify `generate_image` routes to the selected backend.

## Non-goals

- Azure Resource Manager authentication
- Automatic deployment discovery
- Azure-native image generation
- Per-session provider overrides
- Automatic enabling of catalog models or deployments
- Changing existing OpenAI endpoint behavior
