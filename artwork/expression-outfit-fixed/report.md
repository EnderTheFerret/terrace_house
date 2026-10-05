VERIFIED WITH CAVEATS

The per-character sprite library and visual novel controls support expression generation, outfit presets, and custom outfit descriptions. In group conversations, the controls target the selected character. Expression previews persist through an outfit change on the same dialogue line, then return to the conversation's expression when the dialogue advances.

Cutouts now use a solid silhouette without transparent holes. Expression edits composite the generated face over the original outfit image, preserving the body and clothing. A portrait face mask provides a fallback when the outfit's face detector misses. Outfit requests clear conflicting original clothing and accessories; shirtless swimwear and wrap dresses receive explicit garment instructions. Updated cache versions prevent reuse of the flawed assets.

| Claim | Evidence | Result |
| --- | --- | --- |
| Real generation across four characters | Eight neutral/expression pairs: a formal suit, blazer, floral wrap dress, red summer dress, two shirtless swim trunks, one-piece swimsuit and bikini; actual ComfyUI output through the app's API | Passed |
| Expressions preserve clothing | All eight pairs changed face pixels; zero changed pixels below 45% of image height | Passed |
| Cutout integrity | All sixteen tested sprites: zero partially transparent pixels and zero enclosed transparent holes | Passed |
| Group character controls and dialogue context | Screenshots show character selection, custom formal outfit controls, simultaneous expression previews, and neutral expressions on the next dialogue line with outfits retained | Passed |
| Automated checks | 55 focused tests, four browser tests, production build and scoped source lint | Passed |

The real-generation probe uses an isolated game/database. Dialogue responses are scripted solely to make the group screenshots repeatable; artwork generation and image serving use the real backend. The active game was not used for the probe.

Full-repository lint remains blocked by 136 errors and eight warnings in existing downloaded/scratch JavaScript under logs. Scoped source lint passes. A broader test run exceeded the tool timeout and is not claimed as passing.

Screenshots: [suits and dresses](date-results.png), [swimwear](beach-results.png), [character picker](scene-character-picker.png), [formal controls](scene-formal-controls.png), [expression previews](scene-expressions.png), [next dialogue line](scene-next-line.png).

Machine-readable evidence: results.json, expression-body-checks.json, date-mask-checks.json, beach-mask-checks.json and unit-tests.json. Repeat the real generation probe with `npx tsx scripts/artwork-probe.ts --run-real` while the configured ComfyUI service is available.

INTENT: code reuses mismatched outfits and soft masks; the task expects clean figures and selectable suits; the README says outfit choices and generated expressions must appear in the scene.

TWINS: searched copied outfit appearance, expression builders and cutout masks - found 1 other production site: freezeRequest in requests.ts (fixed).
