# Foreground tree composition revision

2026-10-01: the desktop v2 review showed foreground crowns substantially hiding right-hand props. New `procedural-places-v3` retains the same camera, props, seed generator and palette but restricts trees to the background (z < -8 m). It is now selected for new episodes. v1 and v2 layout branches remain available for recorded episodes.

The regression was added before implementation and failed on the unsupported new revision, then passed after v3 implementation. Checks cover six scenes at four boundary/representative seeds and require background trees to remain. Exact SHA-256 fixtures for all six v2 layouts at seed 1 still pass, along with the retained v1 fixture.

Browser observations at seed 1: market stall, cabin door/roof and courtyard house/well are now visible without the earlier foreground crowns. Screenshots: `scenes-v3-market.jpg`, `scenes-v3-cabin.jpg`, `scenes-v3-courtyard.jpg`. All three reached character/voice-start readiness, and browser warning/error query returned no entries.

These are procedural candidates and a specific composition correction, not a complete visual quality verdict. Other scene browser rechecks, all character combinations, full route/turn/near-point videos, low-quality/mobile/Quest performance and final art approval remain open. Existing v2 screenshots remain valid defect evidence, not screenshots of this revision.

Build follow-up: the revised return expression caused TypeScript to infer prop access as unknown. The layout now declares optional typed props and consumers check their presence. `pnpm build` passed; the existing scene bundle size warning remains (602.93 KB, gzip 156.78 KB). Targeted scene catalog, prop geometry and encounter API tests passed: 33 tests across three files. This run uses the local database test backend, not a new PostgreSQL or device performance acceptance run.
