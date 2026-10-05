# Expression and outfit test results

Verdict: VERIFIED WITH CAVEATS — generation, caching and character selection worked; visual defects remain.

Run on 2026-10-05 using the configured local ComfyUI service, an isolated seeded cast and an isolated artwork cache/database. Your active season was not changed. Approved portraits and existing outfit assets were reused where available; missing expression/outfit images were generated through the real image backend. No placeholder artwork was accepted. The browser conversation was scripted for reproducibility; image-generation and standing-figure requests used the real application routes.

| Character | Formal/date outfit and expression | Swimwear and expression |
| --- | --- | --- |
| Ron Azulay | Tailored navy suit — happy | Black swim trunks — sad |
| Kai Levi | Light blazer, black tee, dark jeans — annoyed | Blue swim trunks — excited |
| Maya Cohen | Floral wrap dress — shy | Navy one-piece swimsuit — in love |
| Shira Mizrahi | Red summer dress — nervous | White bikini — angry |

Each outfit was compared with its neutral expression: eight pairs, sixteen displayed variants. The full suit was tested directly through the outfit/expression request builders and real image queue; it is not an option in the current scene menu. The other seven pairs used `/artwork/generate`, with assertions that `/stand` and the per-character library returned the same finished image.

| Check | Observed result |
| --- | --- |
| Real artwork availability | All eight pairs ready, no placeholders; neutral and expression image URLs differ. |
| State isolation | The probe's game state was unchanged by the artwork matrix. No active-season database was opened. |
| Group character picker | Real cached artwork selected separately for Ron and Maya. Changing one character's expression left the other character's image unchanged. |
| Conversation transition | Next dialogue turn restored neutral faces; both retained beach outfits. |
| Existing browser regression tests | All three scene-artwork and sprite-library tests passed. These regression tests use mocked transport and are separate from the live image probe. |

## Visual findings

- **Cutout quality needs repair.** Some expression figures have transparent holes in the skin or clothing, particularly Ron's sad figure and Maya's swimsuit expression. Neutral swimsuit figures also have soft or incomplete edges. The scene screenshots show these defects against the background.
- **Kai's beach clothes do not match the requested shirtless outfit.** His displayed beach portrait keeps a graphic T-shirt with the blue trunks. Cached outfit artwork can therefore report ready while missing a requested clothing detail.
- **Ron retains his original towel** in both the suit and swimwear variants. The clothing edit preserved an unwanted accessory.
- **A full suit is not selectable in the scene menu.** The navy suit demonstrates the pipeline's ability to draw it, rather than a completed user-facing suit option.
- Several expressions are subtle at scene scale, especially shy, nervous and in love. Annoyed, excited and angry are clearer.

Recommended follow-up: repair the cutout mask and affected outfit assets; expose a suit/custom outfit choice if users should request these outfits from the scene controls.

## Screenshots

- [Suits and dresses, neutral versus expression](date-results.png)
- [Swimwear, neutral versus expression](beach-results.png)
- [Group character picker](scene-character-picker.png)
- [Expressions in conversation](scene-expressions.png)
- [Next dialogue turn, neutral faces and retained outfits](scene-next-line.png)

The HTML comparison sheets use local image files and can be opened after the probe server stops. `results.json` records the image URLs and test cases. To reproduce, run `node --import tsx scripts/artwork-probe.ts --run-real`; the probe reuses its verified cache on repeat runs.
