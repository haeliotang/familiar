# Photo-only voluntary memory and generic fallback

2026-10-01: when creating the first person with only photos and no text or audio, the UI asks one optional question about a remembered habit. The user may submit a memory, skip to a general imagined scene, or return to the input form. Asking does not create a person or upload a file. Choosing the generic path submits an empty memory even if text was typed in the question and then abandoned. Existing persons and mixed inputs keep their existing preparation flow.

The client now retains `personalizationLevel` from the server manifest, including history restoration. A server-recorded generic episode displays a generic header and an explicit notice that no usable personal cue was used. Audio cadence levels remain distinct; they are not relabeled generic solely because the visual cue is general. Legacy records without the field remain unspecified.

Verification: four new episode restoration cases first failed because the field was lost; after the fix, episode and upload API tests passed (16 total). The production build passed with the existing scene bundle size warning.

Actual browser flow on localhost with a synthetic 24×24 JPEG: select photo only → optional question with empty-memory continuation disabled → type a synthetic waiting memory → deliberately choose the generic path → upload/preparation complete → generic header, generic footer and no-personal-cue notice. After return, reload and history selection, the generic header and notice remained. Warning/error log query returned no entries. Screenshots: `photo-only-question.jpg` and full-page `photo-only-generic.jpg`.

The browser was connected to the pre-existing local API, so this is not evidence of a restarted latest backend or the latest scene revision. No real person's photo was used. The alternative question “submit memory” button, processing failures and mobile interaction remain to be browser-verified. This implements the explicit low-input fallback; photo subject selection, image-derived factual cues and full M1/M2 personalization remain open.
