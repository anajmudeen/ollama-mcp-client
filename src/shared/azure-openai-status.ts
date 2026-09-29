export function azureOpenaiStatusCounts(deployments: { enabled: boolean }[]): {
  catalogCount: number
  enabledCount: number
  deploymentCount: number
  enabledDeploymentCount: number
} {
  const enabled = deployments.filter((d) => d.enabled).length
  return {
    catalogCount: 0,
    enabledCount: enabled,
    deploymentCount: deployments.length,
    enabledDeploymentCount: enabled
  }
}
