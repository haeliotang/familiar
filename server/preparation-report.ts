export const preparationReportQuery = "SELECT j.status,j.attempts,j.attempt_metrics,ep.status AS episode_status,ep.manifest->>'personalizationLevel' AS personalization_level,ep.manifest->>'qualityLevel' AS quality_level,(ep.manifest->>'degraded')::boolean AS degraded FROM preparation_jobs j LEFT JOIN episodes ep ON ep.id=j.episode_id"

export interface PreparationReportRow {
  status: string
  attempts: number
  attempt_metrics: Array<{ status: string; durationMs: number; jobAgeAtFinishMs?: number | null; providerCostUsd?: number; computeCostUsd?: number | null }>
  episode_status: string | null
  personalization_level: string | null
  quality_level: string | null
  degraded: boolean | null
}

export function preparationReport(rows: PreparationReportRow[]) {
  const attempts = rows.flatMap(row => row.attempt_metrics)
  const percentile = (values: number[], fraction: number) => {
    const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
    return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null
  }
  const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]))
  const completed = rows.filter(row => row.status === 'completed')
  const attemptsWithoutMetrics = rows.reduce((sum, row) => sum + Math.max(0, row.attempts - row.attempt_metrics.length), 0)
  const knownProviderCosts = attempts.flatMap(attempt => typeof attempt.providerCostUsd === 'number' ? [attempt.providerCostUsd] : [])
  return {
    scope: 'persisted preparation jobs; excludes upload, client loading, playback and deleted records; playable is a publication state, not a quality verdict',
    jobs: rows.length,
    jobStatuses: count(rows.map(row => row.status)),
    recordedAttempts: attempts.length,
    attemptsWithoutMetrics,
    retryAttempts: rows.reduce((sum, row) => sum + Math.max(0, row.attempts - 1), 0),
    attemptStatuses: count(attempts.map(attempt => attempt.status)),
    published: completed.length,
    currentlyPlayable: completed.filter(row => row.episode_status === 'prototype').length,
    personalization: count(completed.map(row => row.personalization_level || 'unknown')),
    quality: count(completed.map(row => row.quality_level || 'unknown')),
    degraded: completed.filter(row => row.degraded === true).length,
    workerDurationMs: { p50: percentile(attempts.map(attempt => attempt.durationMs), .5), p95: percentile(attempts.map(attempt => attempt.durationMs), .95) },
    jobAgeAtFinishMs: { p50: percentile(attempts.flatMap(attempt => attempt.jobAgeAtFinishMs == null ? [] : [attempt.jobAgeAtFinishMs]), .5), p95: percentile(attempts.flatMap(attempt => attempt.jobAgeAtFinishMs == null ? [] : [attempt.jobAgeAtFinishMs]), .95) },
    providerCostUsd: attemptsWithoutMetrics === 0 && knownProviderCosts.length === attempts.length && attempts.length > 0 ? knownProviderCosts.reduce((sum, cost) => sum + cost, 0) : null,
    computeCostUsd: null,
    storageAndTransferCostUsd: null,
    unitEffectiveEncounterCostUsd: null,
  }
}
