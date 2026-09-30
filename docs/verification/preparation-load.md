# Twenty-client preparation burst

Local synthetic verification on 2026-10-01. `server/preparation-load.test.ts` exercises 20 independent anonymous users submitting at once, each submitting its identical preparation request twice (40 submissions). It uses actual API handlers, preparation processing and asset validation, four concurrent worker callers plus the service timer, and checks job counts, single attempts, explicit failure reasons, foreign-session rejection, idempotent retries and unchanged episode counts after another worker pass.

Two input sets are exercised on each backend: 20 valid synthetic text memories; and 15 valid plus 5 persons with no evidence. All four cases passed. PostgreSQL 17 ran in the authorized loopback-only temporary Docker container `familiar-pg-load-test`; each case had its own schema, removed afterward. The container was stopped and auto-removed after the run.

Observed terminal latency includes time from burst submission through worker processing and status observation, including queue/lock wait. It is not the worker's duration_ms alone. Status queries are made after each worker round, so values are observation times, not precise individual completion timestamps.

| Backend | Completed / failed | P50 observed ms | P95 observed ms | Max observed ms |
| --- | --- | --- | --- | --- |
| PGlite | 15 / 5 | 268 | 434 | 436 |
| PGlite | 20 / 0 | 253 | 497 | 499 |
| PostgreSQL | 15 / 5 | 266 | 464 | 467 |
| PostgreSQL | 20 / 0 | 261 | 550 | 554 |

Each successful request produced exactly one episode; missing-evidence requests produced none. No paid provider was called. Compute cost was not measured.

Scope limits: Fastify injection bypasses network transport; inputs are synthetic text without photo/audio inference; the local database serializes transactions; concurrent worker callers do not guarantee four jobs always run simultaneously. This is one functional burst per scenario, not repeated capacity/throughput evidence, mobile end-to-end first-visit measurements, or a complete M3/A02/A12 acceptance. Remaining work includes mixed media/model contention, sustained load, worker crash recovery under load, real device and network timings.
