import { expect, it } from 'vitest'
import { preparationReport, type PreparationReportRow } from './preparation-report'

it('includes failed attempts and retries without counting generic or revoked publication as validated quality', () => {
  const row: PreparationReportRow = { status: 'completed', attempts: 2, attempt_metrics: [{ status: 'error', durationMs: 100, providerCostUsd: .1 }, { status: 'completed', durationMs: 200, jobAgeAtFinishMs: 1500, providerCostUsd: .2 }], episode_status: 'revoked', personalization_level: 'generic', quality_level: 'local_placeholder', degraded: true }
  const result = preparationReport([row, { ...row, status: 'failed', attempts: 1, attempt_metrics: [{ status: 'failed', durationMs: 300 }], episode_status: null }])
  expect(result).toMatchObject({ jobs: 2, recordedAttempts: 3, retryAttempts: 1, published: 1, currentlyPlayable: 0, personalization: { generic: 1 }, degraded: 1, providerCostUsd: null, unitEffectiveEncounterCostUsd: null, workerDurationMs: { p50: 200, p95: 300 }, jobAgeAtFinishMs: { p50: 1500, p95: 1500 } })
})

it('reports absent observations as unknown, including missing historical attempt metrics', () => {
  expect(preparationReport([])).toMatchObject({ providerCostUsd: null, workerDurationMs: { p50: null, p95: null } })
  expect(preparationReport([{ status: 'failed', attempts: 2, attempt_metrics: [], episode_status: null, personalization_level: null, quality_level: null, degraded: null }])).toMatchObject({ attemptsWithoutMetrics: 2, recordedAttempts: 0 })
})

it('does not report a complete provider total when historical attempts have no metrics', () => {
  const result = preparationReport([{ status: 'completed', attempts: 2, attempt_metrics: [{ status: 'completed', durationMs: 10, providerCostUsd: 0 }], episode_status: 'prototype', personalization_level: 'generic', quality_level: 'local_placeholder', degraded: false }])
  expect(result.attemptsWithoutMetrics).toBe(1)
  expect(result.providerCostUsd).toBeNull()
})
