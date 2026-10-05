VERIFIED WITH CAVEATS

The visual novel generator accepts written clothing and expression descriptions for the selected character. It offers expression-only, clothing-only and combined generation. Custom expressions override the preset, including when neutral is selected. Expression-only uses the clothing already shown rather than the clothing draft in the form. Clothing-only generates a neutral-faced clothing variation without an expression-generation step. Combined generation applies both descriptions.

| Claim | Observed evidence |
| --- | --- |
| Written expressions reach generation and are retrieved in conversation | Server integration check captured the exact description in the face-edit prompt, verified its cached conversation URL and library lookup, and rejected blank or oversized descriptions. |
| All three controls target only the selected character | The targeted browser flow verified clothing-only omitted the expression description, expression-only ignored the clothing draft, and combined generation sent both descriptions. The other participant retained its artwork. |
| Expressions follow conversation context | The same browser flow verified the custom expression preview cleared on the next dialogue line while the selected clothing remained. |
| Original art style retained | Seven corrected portraits were generated using their original pixel-art portraits as references. The cast screenshot and the Shira/Maya comparison were visually inspected. |
| Focused checks pass | 52 tests across image requests, the server, library integration and client image handling passed. The targeted scene-artwork browser test, production build and lint of the changed TypeScript files passed. |

No further GPU outfit matrix was run after the user said testing was sufficient. The earlier interrupted matrix and its intermediate output were removed. The final face mask additionally intersects the detected face with the original character silhouette; its wiring was verified in the workflow test, without another GPU generation run. Knees-up framing uses the top 80% of an upright, frame-filling source; arbitrary poses were not tested. Whole-repository lint was not claimed.

No checks were skipped or relaxed. The browser locator now waits specifically for the displayed image rather than matching the temporary portrait container and canvas. Its mode assertions were expanded to cover both free-text descriptions and independent generation. Existing season and unrelated work were preserved. Temporary probe files were removed; running image-service diagnostics remain in the earlier probe directory.

INTENT: code preserves full-body references and uses mid-thigh prompts; the task expects knees-up figures with proportional heads and elegant dresses; the README describes reusable portraits and outfit changes in dialogue.

INTENT: the generator supported custom clothing but preset expressions; the user requested written clothing and expressions with independent or combined generation; the README now describes those three actions and their conversation behavior.

TWINS: searched portrait framing and dress prompts - found 1 other generation path: scripts/assets/comfy_gen.py (fixed). The generated asset job list was refreshed, and the original pixel-art style prefix was restored.

[Generator controls](generator-controls.png) · [Original style comparison](portrait-style-comparison.png) · [Seven corrected portraits](cast-portraits.png)

Recommended action: use the character artwork controls in a visual novel scene. Choose a character, enter either description or both, then select the corresponding generation action.
