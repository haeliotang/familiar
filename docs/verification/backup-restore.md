# Synthetic database/media restore drill

Completed locally on 2026-10-01 with `node --import tsx scripts/verify-backup-restore.ts`. This opt-in script starts its own disposable PostgreSQL 17 Docker container on loopback port 55438 and creates only synthetic data; it must not be repurposed to target an existing database. Docker must be running and the port free.

The script created a private synthetic JPEG, a text memory and a prepared episode through the actual API handlers. It stopped the application before copying private media and running pg_dump, restored the SQL into a separate database with psql ON_ERROR_STOP, copied the private media into a different directory, and started a new app instance using that database/root.

Verified:

- Restored schema readiness returns 200.
- The one normalized private file retains its SHA-256.
- Episode manifest is exactly equal to the pre-backup manifest.
- The standard voice response has identical bytes.
- Repeating the saved preparation key returns the same job and leaves one episode.
- Another anonymous session cannot read the restored episode.
- Deletion immediately refuses episode and voice reads and removes the restored private file.

Result: `synthetic_restore_passed`. Temporary pools/apps, container and backup/media directory were cleaned after completion. Build passed with the existing scene chunk warning.

The first run exposed an initialization readiness race; the probe now uses TCP rather than the container's default Unix socket. A subsequent run corrected the script's expected upload response to the actual 202 interface. The final full run passed.

Limits: API injection, not an external network/TLS deployment; no live traffic during backup; no real/private user data, long audio, retained cadence audio or production scale; no application-version rollback, backup encryption/retention system or disaster recovery timing. This proves a local matching database/media restoration for the tested synthetic case, not complete M4 release acceptance.

## Follow-up: retained cadence audio

On 2026-10-01 the same disposable drill was extended and executed successfully against the current compact-v4 / performance-v4 worktree. The original standard-voice episode is retained as a control. A second episode uses an actual uploaded synthetic Kokoro phrase repeated three times after FFmpeg tempo adjustment and inserted silence. Actual normalization, local audio observation, explicit source/window confirmation and preparation produce confirmed_window_rate with pauseTransfer=true; no controlled observation fixture replaces inference.

Before backup, the generated voice hash matches its manifest. After pg_dump/psql and media restoration, both episode manifests remain equal, both preparation keys deduplicate, and both voice byte hashes match their pre-backup values. The second voice is served from retained database audio. A foreign session cannot access it. Person deletion refuses both voices, clears the retained cadence value and removes both normalized private files.

Result: synthetic_restore_passed, privateFiles=2, including retained_cadence_bytes. The script completed with exit 0 and cleaned its temporary container and directories. This closes the earlier retained-cadence omission for this synthetic case; production scale, live-traffic backup, TLS deployment, older-code rollback, retention/encryption and recovery timing remain unverified.
