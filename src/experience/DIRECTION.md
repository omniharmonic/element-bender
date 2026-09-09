# Element Bender — creative and technical direction

A living landscape fills the screen. Controls sit at the edge like the markings on a scientific instrument; the material itself carries the spectacle.

Palette: deep marine #101e29, twilight blue #627e9b, cloud pearl #edf0eb, sunset apricot #edac82, ember #e88344, fern #89a785. Display: Georgia, light and spacious; interface: system humanist sans. Labels in sentence case. No cards in the scene.

Layout: quiet wordmark and camera control across the top; short element introduction at left; a centered four-element switcher above the bottom edge; bending tools and instructions below. Settings and help appear only on request. Narrow screens compress the header and stack instructions without covering the material.

Review: avoid a static scenic landing page. Start inside the live cloud simulation; every mode must support mouse, touch, and optional camera input. Avoid particle sprites as the main material. Clouds use volumetric integration and light extinction. Fire uses an advected temperature/smoke field with pressure projection. Water uses neighbor-based incompressibility and reconstructed continuous surfaces, plus propagating surface waves. Earth uses a persistent height field, drainage routes, and terrain-dependent vegetation.

Tradeoff: a consistent WebGL2 renderer is chosen for mature, inspectable custom GPU passes across browsers. This is an interactive approximation, not a claim of scientific computational fluid dynamics. Preserve existing implementation files for comparison.
