# Limited viewer positions and turning

2026-10-01: the actual `Scene` now offers left/right viewing, a nearer standing point, a seated viewing point and return to the recorded camera. This changes the viewer camera, not the character action. Turning is limited to ±60 degrees in 15-degree increments. The near/seated points remain beside the 4 m walking lane at x=3.2 m, z=4.5 m; eye heights are 1.7 m and 1.15 m respectively. A new scene mount restores its recorded camera.

The spatial audio listener updates to the camera position, forward and up vectors each frame, using either modern AudioParams or legacy listener methods. Character voice-source placement and encounter timing remain unchanged.

Verification: nine targeted tests passed across viewer geometry, modern/legacy audio listener updates and existing playback tests. The production build passed; scene chunk size warning remains (604.21 KB, gzip 157.12 KB).

Browser acceptance remains pending. The existing scene review tab was confirmed in the browser inventory, but three observation attempts (AX, screenshot and DOM) timed out while enabling focus. No screenshot or actual click result was obtained for this feature. This is not evidence of a successful visual or audio interaction. Per-scene visibility/collision checks, mobile layout, spatial listening, transition comfort and full encounter playback remain required. Positions currently change immediately; this implementation does not prove character sitting, furniture contact or final A14 acceptance.

## Browser follow-up

The previous review tab was subsequently absent from the browser inventory. A fresh tab in the same selected browser opened the actual Scene harness successfully. At seed 1 with the adult male candidate and playback time 0, river controls visibly changed the default view to near standing, seated and left-facing views; right-facing and return controls were also clicked, with the final screenshot showing the restored original composition. Screenshots: `viewing-original.jpg`, `viewing-near.jpg`, `viewing-seated.jpg`, `viewing-left.jpg`.

The seated point was then visited in courtyard, farm, workshop, cabin and market. Each rendered from the new eye height, reached character/voice readiness, and the eye was not visibly inside a foreground prop. Screenshots: `viewing-{courtyard,farm,workshop,cabin,market}-seated.jpg`. The browser warning/error query returned an empty list. These static checks supersede the earlier observation failure for these specific interactions. Only river had near-standing/turn/return checks; the other five had seated checks. None proves a full route, spatial audio listening quality, mobile/Quest behavior, all seeds/characters or A14 acceptance.
