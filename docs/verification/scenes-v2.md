# Six scene candidates

Verified locally on 2026-10-01. This is an implementation check, not an art or human experience acceptance result.

`procedural-places-v2` cycles riverside, courtyard, farm, workshop, cabin and market. Each has its own palette and fixed props. Layout generation clones props and excludes nearby generated trees. Recorded `procedural-path-v1` episodes retain their original layout; the retained courtyard fixture has SHA-256 `b6a775a277a81555545eb00d698c7a813f3fb2064b1e4ba08cdcd23b3d690352`.

Verification:

- Scene catalog, prop geometry, encounter and API tests: 43 passed.
- After correcting test cleanup to dispose a Three.js Scene, prop tests: 6 passed; production build passed. The existing scene chunk size warning remains (approximately 603 kB before gzip).
- Browser preview rendered the v2 riverside demo with its bench. Screenshot: `scenes-v2-riverside.jpg`.
- All six prop groups were checked using actual geometry bounds: no prop enters the walking lane and none extends below ground beyond the stated tolerance.

Remaining: browser visual checks for the other five scenes, mobile performance, art quality review and human acceptance. Synthetic materials remain the test source. No real person recording or familiarity result is claimed.

## Preparation and replay chain

The added API test publishes seven episodes through the preparation queue, covering all six scene IDs and the next riverside episode. It checks completed jobs, version and seed resolution into a renderable layout, canonical manifest hashes, idempotent preparation retries, every saved episode read and all seven history entries. The focused check passed with the local PGlite database. This adds server publication evidence; it does not prove the other five browser views or device performance.

After adding this check, the combined scene catalog, prop geometry, encounter and API run passed all 44 tests. The production build also passed; the scene chunk size warning remains.

## Content gaps inspected

The character catalog still contains two adult identities. The source animation library contains sitting entry/exit/idle, interaction and table pickup clips in addition to the four currently retargeted clips. These can support further candidate production, but their presence does not prove compatible contact, twelve finished product actions, older adult appearance or a smile facial shape. Those requirements remain open.

## Desktop browser scene review

`scripts/verify-scenes.html` now mounts the actual Scene component with the fixed synthetic demo (seed 1, existing adult male) and provides all six scene buttons plus unmount/re-entry controls. This is a local development review page, not the released user flow or a separate renderer.

All five additional scenes reached the ready character/voice-start controls in the desktop in-app browser. Saved `scenes-v2-courtyard.jpg`, `scenes-v2-farm.jpg`, `scenes-v2-workshop.jpg`, `scenes-v2-cabin.jpg` and `scenes-v2-market.jpg`. Market exit removed the scene and showed the exited state; re-entry returned to ready. Browser warning/error query returned no entries. Build passed with the existing scene chunk warning.

Visual defect: near-camera tree crowns substantially obscure the distinguishing right-hand props in courtyard, workshop, cabin and market at this seed and fixed camera. Farm has partial foreground obstruction too. These candidates do not pass final art review; the screenshots are defect evidence. Correct composition in a new retained scene revision, preserving existing recorded layouts. Full-route playback, turn checks, both compatible characters, all relevant seeds, actual mobile performance and video evidence remain outstanding.
