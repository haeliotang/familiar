# Deployment and rollback procedure

This procedure prepares a PostgreSQL-backed local/staging service. Production deployment and the M4 rollback exercise are not yet completed. Do not use synthetic checks as approval for real private data.

## Release contents

Keep one immutable checkout/release directory with the lockfile, code, verified public asset versions and model installers. Record the Git revision, `dependency-lock.md` and the public asset hashes with each release. Retain all asset/voice/animation versions referenced by saved episodes when rolling forward or back. Rebuilding a voice under an existing version is not a compatible rollback.

The source entrypoint currently uses `tsx`; install the full locked dependency set rather than pruning dev dependencies. Node 22, FFmpeg/FFprobe and heif-convert are required. Install the fixed local speech, ASR and VAD models using the README commands, then run `pnpm check:local`. Keep `.models`, private media and credentials outside the public web root and Git.

## Configuration and start

Set environment variables using the service manager or shell. The application does not automatically load `.env` files.

- `DATABASE_URL`: the dedicated PostgreSQL database connection. Use the deployment's TLS configuration and least-privilege application credentials.
- `ASSET_DIR`: an absolute private media directory on persistent storage, writable by the service user. Do not place it under `public`, `dist` or any web-server document root. Restrict filesystem access to the service user and backup operator; use a private creation umask.
- `PORT`: optional, default 3001; must be an integer from 1 to 65535.

`pnpm start` validates these fields before creating the service and listens only on 127.0.0.1. A separately configured TLS reverse proxy must serve `dist` and route `/v1` to that loopback service. The proxy must not expose private media or model directories. Reverse-proxy/security configuration is not supplied or verified by this procedure.

Before starting:

1. Back up the database and private asset directory together; verify restoration in a separate test database/directory.
2. Run `pnpm install --frozen-lockfile`, `pnpm build` and the applicable tests/preflight.
3. Run `pnpm db:migrate` against the intended database. The readiness endpoint validates required schema relations/columns; it does not apply migrations itself.
4. Start with `pnpm start`. Check `/health/live` and `/health/ready`; ready must return HTTP 200. Readiness currently checks the schema, not full media/tool/model availability, so preflight is an additional required step.
5. Run a synthetic session through upload/preparation/playback/history, idempotent retry and deletion; verify storage cleanup. Record timings including queue wait and client loading. Do this before inviting people.

## Rollback

Stop new preparation submissions and stop the service gracefully (SIGTERM); the current shutdown handler waits for Fastify closure, including active preparation/deletion processing. Restore the last verified compatible release directory and its model configuration, preserving persistent database/media. Start it and re-run readiness and synthetic playback/deletion checks. Keep a record of start/end times and observed failures.

Choose a release that understands every published episode schema and its asset/voice/performance versions. The new source-bound cadence manifests and retained audio cannot be assumed playable by an older implementation. Do not drop columns or overwrite stored manifests to make an old binary start. If database restoration is required, use the verified matching backup and document the resulting loss of newer records before any real use. Database and media restoration must remain consistent.

## Current verification limits

Configuration checks reject missing database/storage and invalid ports. Local and temporary PostgreSQL tests cover schema, transactions and several shutdown/deletion/publication cases. A disposable synthetic database/media restoration has been exercised; see `docs/verification/backup-restore.md`. There has been no deployed TLS/proxy exercise, production backup recovery, production release, real version rollback or Linux runner result yet. Those remain required evidence for M4.
