# Azure deployment model + reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store Azure model id per deployment, gate reasoning effort in chat and API.

**Architecture:** `src/shared/azure-deployment.ts` + extended `AzureOpenaiDeploymentEntry`; Models UI; Chat resolves selected deployment; Azure `buildChatBody` uses deployment.model.

**Spec:** `docs/superpowers/specs/2026-10-09-azure-deployment-model-reasoning-design.md`

## Global Constraints

- `supportsReasoning` = checkbox + non-empty model + `openAiModelUsesReasoningEffort(model)`.
- Chat selection remains deployment **name**.

## Verification

- `npm run typecheck`
- `npm run test:azure-deployment-reasoning`
- `node --test scripts/test-reasoning-effort.mjs`
- `node --test scripts/test-azure-openai-client.mjs` (requires config-store write access)
