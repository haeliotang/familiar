# PostgreSQL service configuration

2026-10-01: the PostgreSQL startup entrypoint now requires an explicit absolute ASSET_DIR as well as DATABASE_URL, and validates PORT before creating the pool/service. Previously a missing asset directory was passed through and media routes could be absent while the service started. The local PGlite startup retains its existing developer directories.

The .env example includes the persistent private directory; `pnpm start` runs the source entrypoint without watch/reload. Environment loading remains the service manager's responsibility. An absolute path alone does not establish private filesystem permissions or prevent symlink/public-root mistakes: operators must follow `docs/deployment.md` and keep the configured root outside all public serving paths.

Configuration and readiness tests: 9 passed. Production build passed with the existing scene bundle warning. No production connection, credential setup or deployment was attempted. Real startup, restore and rollback evidence remains required for M4.

The actual `pnpm start` command was also invoked with a dummy local database URL and ASSET_DIR deliberately unset. It exited with code 1 and `ASSET_DIR is required` before pool creation or listening, as intended. This negative startup check is not a successful deployed service exercise.
