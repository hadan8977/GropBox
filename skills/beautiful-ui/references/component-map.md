# Component selection

Inspected on 2026-09-22 against [the official gallery](https://www.beautifului.dev/) and [slev12397/beautiful-ui](https://github.com/slev12397/beautiful-ui). This is a curated adaptation, not an official Beautiful UI distribution.

| Reference | Reusable idea | Production boundary |
| --- | --- | --- |
| GlideMenu | One sliding highlight for nearby actions | Bundled GlideActions uses plain CSS, keyboard focus, native buttons, and reduced-motion support. Keep the MIT notice. |
| CodeBlock | Copy/check feedback without shifting content | Bundled FeedbackButton is controlled. The caller must await the clipboard promise and handle rejection/unavailable APIs. |
| TaskRows | Dense task rows and a compact summary | Upstream timed sequences are demos. Use actual task state, accessible disclosure, visible errors, and retry callbacks. |
| PromptBar | Attached files above a compact composer | Upstream demo dictation and attachment names are not real recording/upload implementations. Preserve draft state until accepted. |
| ThinkingState | A quiet indication of genuine pending work | Upstream staged timing is simulated. A file-transfer utility needs transfer states, not AI reasoning labels. |
| SidebarNav | Compact selection and consistent icon rhythm | Do not copy the paid Central Icons dependency. Retain the app's icon library. |

The inspected site is React/Tailwind-oriented; some examples add other packages. GropBox's adaptation uses React and scoped plain CSS, with icons supplied by the caller. No Tailwind, animation engine, paid icon pack, or AI service is required.

In GropBox, the primitives are used in message copy and the message action dialog. TransferQueue separately applies the TaskRows disclosure idea to the existing upload manager; it is intentionally app-specific, not a second upload state machine.
