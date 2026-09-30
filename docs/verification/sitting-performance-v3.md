# Seven-clip character and sitting performance candidate

2026-10-01: two new immutable avatar IDs, `adult-peasant-male-sitting-v2` and `adult-peasant-female-sitting-v2`, retain the original head/body/walking metadata while pinning separate seven-clip libraries. The original four clips are copied exactly; three sitting clips are copied exactly from each body's interaction candidate. Each combined library records both source library paths and SHA-256 values. This adds no identity, body, facial expression or new voice.

`character-timeline-v3` sits down over 0–1.3 s, holds the seated loop until about 10.967 s, then rises before walking at 12 s. The retained v2 repair sequence follows unchanged. The actual Scene creates a 0.46 m stool behind the initial actor, at path floor height. Caption text describes sitting/rising. New performance with an old four-clip avatar rejects before asset loading; new avatar loads require all seven clips. Female voice and repair-prop selection support the new female version.

New episodes still select v1 avatars and performance v2. The new pair is an explicitly selectable runtime review candidate, pending close-range contact/transition and both-body checks. The actual scene harness selects it with `/scripts/verify-scenes.html?actions=sitting` and `&character=female`.

Verification: the new timeline test first failed on unsupported v3; the compatibility test first failed because old avatars were not rejected. After implementation, 24 tests across catalog, loading, timeline, caption and repair prop passed; build passed with the existing scene bundle warning (605.73 KB, gzip 157.56 KB). Catalog tests bind all new asset hashes, source library hashes, exact clip composition, seven valid clips and the female voice.

Browser male seed-1 river observations: new character/voice readiness, start playback, 13 s walking state without errors, reset/replay, pause at approximately 10.97 s with rising caption and visible low seated/rising silhouette. `sitting-scene-v3-male.jpg` records this frame. Warning/error query was empty. The actor remains small in this camera; this does not establish stool contact quality or exact action transition continuity. Female actual-scene playback, close-range floor/seat contact, all scenes/cues and full 75 s playback remain open. No formal seven-action asset release or M3 completion is claimed.

## Close-range follow-up

The actual Scene accepts an optional review frame (time, eye, target), supplied only by the development harness. `&close=1` exposes a time input and frames the initial actor from [2.4,1.3,-15] towards [0,.9,-18]. Normal encounters retain their playback and camera controls. Review mode shows a fixed frame and hides transport controls; it is not a continuous playback test.

Female and male were inspected at 5 s seated, 11.6 s rising and 12.5 s walking. Seated hips appeared positioned on the stool rather than standing through it, and rising/walking frames showed the actor leave the stool. Screenshots are `sitting-close-female-{5,11-6,12-5}.jpg` and `sitting-close-male-{5,11-6,12-5}-shadow.jpg`. The female frames without `-shadow` predate the lighting correction below. Static screenshots do not prove contact at every frame or continuous transition quality.

The inspection found missing shadows at the initial actor: the default directional-light frustum did not cover z=-18, and the path did not receive shadows. A test using the existing light settings failed at time 0. The production light now covers ±24 m in its shadow camera, uses a 1024² map and the path receives shadows. The test covers actor envelope corners (x ±0.4 m, height 0–2 m) at every whole second of the 75 s route. Actual male and female 5 s frames show actor/stool shadows (`sitting-close-{male,female}-5-shadow.jpg`); browser warning/error query was empty. This shared renderer correction also affects shadows in retained episodes; it does not alter their recorded geometry or animation libraries. GPU cost on phones and pixel-identical historical rendering are not verified.

Default activation remains pending full continuous playback and scene/cue checks. These close frames strengthen the candidate evidence but do not close A13, M3 or formal asset acceptance.

After the review-frame and shadow changes, 22 targeted tests across sunlight coverage, timeline, catalog and character loading passed. Production build passed; the existing scene chunk warning remains (606.23 KB, gzip 157.76 KB).

## Matching voice and full-duration follow-up

The review previously used `/v1/voices/demo`, which always returned male/general audio even for female or repair review configurations. Six new cases reproduced the wrong request path. Demo playback now selects the pinned voice version by avatar and cue, verifies its actual SHA-256 bytes, and decodes those bytes. Personal episode playback retains the authenticated episode voice route. Replaced demo audio is rejected before decoding. The harness accepts `cue=repair` or `cue=wait` for explicitly labeled review input; these synthetic selections are not personal evidence.

Female v3 / repair / river / seed 1 reached ready, started with sound and subsequently reached 75 s with the finished state. Restart restored 0 s and the sitting-entry caption. Browser warning/error query returned no entries. `sitting-full-female-repair-end.jpg` shows the terminal state. This verifies transport completion for one combination, not continuous visual observation of every frame, audio listening quality or all scene/cue/body combinations. At this terminal point the onward-walking actor has left the recorded camera view.

Actual male/female library sampling now checks the three new sitting boundaries (1.3 s, approximately 10.967 s and 12 s) for all three cues, plus backward-seek determinism. It uses named bones driven by the actual clip tracks, not full skinned-mesh contact measurements. A broader initial check detected a retained Idle_Loop seam at 43 s: spine_02 endpoint rotation differs by approximately 0.002926 rad (0.168 degrees). Direct examination of the retained four-clip file confirmed that its 0 s and 2.5 s quaternion endpoints differ. This remains an existing content-quality issue; the new-boundary checks do not claim it fixed.

26 targeted tests passed across timeline, matching voice, asset verification and playback; production build passed with the existing scene chunk warning (607.18 KB, gzip 158.35 KB). Default activation remains pending remaining runtime combination and visual checks.

## Idle seam correction within the unreleased v3 performance

The full stage-boundary test was restored and reproduced the 43 s spine_02 discontinuity for both actual body libraries. The unreleased v3 runtime now clones Idle_Loop and blends its final 0.2 s towards its initial pose with a smoothstep weight; quaternion tracks use normalized spherical interpolation, other track components use linear interpolation. The source clips and all pinned files remain unchanged, and v1/v2 timelines use their original clips.

The expanded actual-track test now passes at 1.3 s, approximately 10.967 s, 12 s, 28 s, 33.2 s, 43 s, 45 s, 55 s and 72 s for both bodies and all three cues, with the original 1 mm position and 0.002 rad angular thresholds. It also checks backward-seek determinism and verifies all supplied clip JSON remains unchanged after playback. 21 targeted timeline/catalog/retained-clip tests passed. This corrects the detected runtime seam for v3; the retained asset endpoints still differ, and the test remains a named-bone sampler rather than a complete mesh/contact or perceptual quality test.

Production build passed after this correction; the existing scene bundle warning remains (607.70 KB, gzip 158.52 KB).

## Local default activation

The male v3 / wait / river / seed 1 review reached 45 s with its matching waiting line, then 75 s and the finished state without warning/error entries. `sitting-full-male-wait-end.jpg` records the terminal state. This adds a second full-duration transport check; it is not a continuous perceptual review of every frame or all combinations. All six seed-1 scene prop groups were checked against the actual initial stool bounds, with no intersection; background trees also clear that slot. This geometry check does not model all skinned-body motion.

New local encounters and the demo now select the seven-clip male/female IDs and performance v3. The two-episode gender cadence remains unchanged. Retained male/female IDs continue to resolve their original four-clip paths and hashes, their corresponding voices and repair props. The selector test first failed on the old default, then passed after activation. The original loader disposal/compatibility tests explicitly use retained IDs; catalog tests check both retained and new packages.

81 tests across nine affected client/API files passed, including six-scene preparation/history/idempotency and pinned version storage. Production build and the local dependency/asset preflight passed. These API tests use the local test backend, not a fresh PostgreSQL run. The live development API was then gracefully stopped, restarted from current source and returned `{"status":"ready"}`. In the actual localhost app, the earlier synthetic photo-only record loaded its old standing caption, original scene and ready character/voice. A new preparation using the same synthetic materials completed with the v3 sitting-entry caption, revised courtyard scene and ready character/voice. Screenshots: `retained-avatar-after-default.jpg`, `new-default-avatar-prepared.jpg`. Browser warning/error query returned no entries.

This activates the candidate in the local prototype; it does not approve production art or close M3. All 36 scene/body/cue combinations, full-frame contact/transition reviews, mobile performance and formal asset acceptance remain open. No six-identity or twelve-action completion is claimed.
