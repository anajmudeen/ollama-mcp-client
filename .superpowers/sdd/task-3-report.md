# Task 3 Report: Provider uses deployment-name heuristics only

## Status

**DONE**

## Summary

Removed catalog usage from `azure-openai-provider.ts`. Exported `azureDeploymentTags(deploymentName)`; vision tagging uses `isOpenAiVisionModel(deployment.name)` only. `listModelsForChat`, `getModelInfo`, and `detectVisionSupport` no longer call `getAzureOpenaiModelsCatalog` or `matchedCatalogMetadata`.

## Verification

- `node scripts/test-azure-deployments-only.mjs` — 4 passed
- `npm run typecheck` — passed

## Self-review

- Catalog helpers (`catalogForDeployment`, `azureModelTags`, `modelInfo`, vision capability regex) removed.
- `modifiedAt` is always empty (no catalog `created` timestamp).
- `catalogModelId` set only when deployment name matches vision heuristics.

## Concerns

- Deployment names that do not match `isOpenAiVisionModel` but point at a vision backend will report `unknown` vision support (intentional per brief).

## Commit

`d03888d` — feat: tag Azure deployments without catalog metadata
