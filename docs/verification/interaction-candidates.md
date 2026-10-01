# Interaction animation candidates

Produced locally on 2026-10-01 using the existing CC0 Quaternius animation library and Three.js 0.180.0 retargeting. No model download or new dependency was needed.

The `--extended-candidate` option of `scripts/retarget-character.ts` writes to `interaction-candidate-v1` under the selected body directory, leaving the recorded runtime animation package intact. Both male and female outfits now have five candidates: Sitting_Enter (1.30 seconds), Sitting_Idle_Loop (1.67), Sitting_Exit (1.03), Interact (2.00), PickUp_Table (0.83). Each has 66 tracks and retains the target bone positions.

Commands used:

```
node --import tsx scripts/retarget-character.ts --extended-candidate --outfit
node --import tsx scripts/retarget-character.ts --extended-candidate --outfit --female
pnpm exec vitest run src/interaction-candidate.test.ts src/character-clips.test.ts --maxWorkers=2
```

All five tests passed. The checks bind source and target hashes to the files, resolve the provenance references, deserialize and validate the actual clips, require pelvis/head tracks, and check finite full-mesh contact samples at 30 Hz. The existing four-clip runtime packages still pass their checks.

Uncorrected minimum mesh surfaces range approximately -5.04 to -1.56 cm for the male and -4.84 to -2.25 cm for the female during sitting entry. These are diagnostic bounds before runtime ground correction, not proof of foot or seat contact.

Remaining before runtime publication: visual retargeting review, a seat at the actual pelvis contact location, hand/object contact and attachment timing, entry/exit blending, ground correction, the same checks on combined head/body characters, and device measurements. These candidates do not satisfy the twelve product actions or six adult identities requirement yet; in particular no smile facial shape has been established. They are not selected by the episode planner.

## Joint placement diagnostics

The candidate producer now records pelvis, both hands and both feet at 30 Hz after the same per-frame full-mesh ground correction used by the runtime. `joint-samples.json` binds measurements to the actual body hash and labels joint centres as distinct from skin contact points. Tests check all frame times, finite coordinates, expected lowering/raising of the pelvis and sitting entry/idle/exit boundary distances below 1 cm for all five joints.

Measured sitting pelvis centres: male 0.5633 m above ground, female 0.5765 m, approximately z=-0.3315 m in character coordinates. Standing endpoints are approximately 0.925–0.927 m. These establish placement coordinates for review, not the correct seat surface height: buttock skin and seat intersection still need inspection.

## Browser review tool

`http://127.0.0.1:5173/scripts/verify-character.html?textures=webp&actions=interaction` loads the existing four clips plus the five interaction candidates. Add `&character=female` for the other body. Candidate buttons run entry, exit, pickup and interaction once and hold their final pose. The page allows an exact animation time and an adjustable translucent seat surface (initial top 0.46 m). This is a review surface, not a finished chair asset.

The male sitting idle candidate was rendered with ground correction, seat surface and combined head/body. Saved `interaction-seat-male.jpg`; browser error and warning log queries returned no entries. Build passed with the existing scene chunk size warning. This observation establishes loading/rendering only, not the full contact or route acceptance; female browser review and actual furniture construction remain open.

### Supported seat and female preview

The initial translucent plane has now been replaced with an opaque review stool: a 0.70×0.55 m surface, 0.08 m thick, and four 0.07 m square legs. Height adjustment changes both surface position and leg dimensions. Actual geometry bounds tests at surface heights 0.30, 0.46 and 0.65 m show legs touching the floor and seat underside. Invalid heights are rejected. The seat and interaction tests passed (3 tests).

The female combined character sitting idle was rendered on this stool with ground correction at the initial 0.46 m seat height. Screenshot: `interaction-seat-female.jpg`. Browser error and warning queries returned no entries. This supersedes the missing female loading/rendering observation above; it does not finish skin/seat intersection, entry/exit or hand/object quality acceptance.

### Continuous sitting review

The review page now offers a deterministic entry → four-second sitting hold → exit sequence (approximately 6.33 seconds). It supports pause and absolute time seeking and holds the final exit pose. Actual male/female clips are exercised in tests for backward seeking, stage selection, distinct seated/standing poses and endpoint clamping; combined sitting, joint and seat checks passed all 5 tests. The binding test uses named bones with actual tracks, not the full skinned model, so it does not establish visual rig quality.

Browser checks on the combined female head/body resolved the sequence to Sitting_Idle_Loop at 2 seconds and Sitting_Exit at 6.33 seconds, visibly seated then standing by the stool. Saved `sitting-sequence-exit-female.jpg`; no warning/error entries returned. Build passed with the existing scene chunk warning. Continuous video/contact review, male combined sequence observation and planner publication remain open.

### Pickup target and binding

The reviewer now derives the table and wireframe target from the maximum forward position of the sampled left hand, independently for male/female bodies. The male reach frame is 0.2667 seconds; the table and target are visible there in `pickup-contact-male.jpg`. At and after that time the marker attaches at the left hand joint centre, returning to its table coordinate on backward seeking or switching actions. It is a diagnostic marker, not a finished grasp prop or finger-contact result.

Four tests passed: actual male/female reach positions, table legs meeting the floor/underside, invalid data rejection, attachment timing and deterministic restoration on backward seeking. Browser observation at 0.4 seconds shows the combined male character holding the marker (`pickup-grip-male.jpg`); no browser warning/error entries returned. Full trajectory contact, fingers, final prop geometry, release behavior and female combined binding remain open. The episode planner still does not select these candidates.

### Palm reference revision

Both actual outfit rigs and the pickup tracks include left index/thumb bones. The producer now samples the midpoint of index_01_l and thumb_01_l plus the world hand quaternion. The marker uses this midpoint as its initial target and converts the contact-frame offset into hand-local coordinates for attachment, instead of snapping to the wrist centre. This is a joint-derived palm reference, not a skin surface or finished finger grasp. The pickup and joint tests passed (6 tests), including a nonzero attachment offset and backward restoration; build passed. Browser visual acceptance for this revised palm location remains pending. Earlier screenshots above record the wrist-centre revision and are not evidence for the revised palm contact.

### Eight-clip package preparation

User revised the content target to two bodies and eight actions. `scripts/package-pickup-clips.ts` now creates male/female `peasant-*-pickup-v3/animations.json` candidates, preserving all seven sitting-v2 clips exactly and adding the actual retargeted PickUp_Table clip. Both source packages are bound by SHA-256. Six package/contact tests passed; both libraries deserialize and validate eight distinct clips, including the left-hand track. No dependency or asset download was added.

These packages are not yet selected by the runtime or planner. Finished prop geometry, contact/release behavior, a versioned timeline and combined-character visual review remain necessary before calling the eighth action delivered. The already pushed default stays sitting-v2 and seven clips during this preparation.

Later in the same day, pickup-v3 packages and timeline-v4 were integrated and selected for new local encounters, with a solid object, table, release/rewind behavior and actual combined-character checks. See pickup-performance-v4.md for current evidence and remaining quality limits. The preparation paragraph above records the earlier stage.
