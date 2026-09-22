---
name: beautiful-ui
description: Adapt Beautiful UI interaction patterns for conversational and task-focused React interfaces. Use for compact action menus, truthful async feedback, attachment composers, and transfer disclosures. Includes plain-CSS React primitives; not a complete application framework or an AI backend.
---

# Beautiful UI

Use the visual economy of [Beautiful UI](https://www.beautifului.dev/) without importing its simulated workflows. Preserve the user's product and interaction contracts. A visual demo is evidence of appearance, not evidence of production behavior.

## Choose the useful part

Read [the component map](references/component-map.md) before choosing a pattern. Check the target application's state ownership and styling system. Keep existing icons, typography, spacing, and accessibility mechanisms where they already work.

The bundled source library in `assets/react/` has two independent React + TypeScript primitives and one plain CSS stylesheet:

- `GlideActions`: one moving pointer/keyboard highlight behind native action buttons. It supplies no menu role, keyboard-navigation model, or business actions. Use normal Tab navigation unless the application already implements a full menu.
- `FeedbackButton`: a controlled icon transition for `idle`, `pending`, and `success`. The caller supplies icons, performs the operation, reports errors, announces success, and resets success state. Keep the accessible label stable; the tooltip may say “Copied”.

Copy only the selected primitive and needed CSS into the project's existing component directory. Preserve `LICENSE` when adapting GlideActions. These are source templates, not an npm package or shadcn registry; no install command is required. In GropBox, `src/components/ui/` is the maintained implementation and these assets are a reuse snapshot. Refresh that snapshot only when changing the reusable primitives, not for app-specific styling.

## Integration rules that affect behavior

- Derive task status, byte counts, and errors from real operations. Do not drive progress or success with a demo timer. A short feedback-reset timer is different from a simulated operation.
- Await clipboard/upload/save success before showing completion. Keep drafts on failure and expose a retry or useful error. Never clear the input merely because an animation started.
- A collapsible task group needs `aria-expanded`, `aria-controls`, and inert hidden content. Keep failure counts visible when collapsed. Distinguish staged attachments from active transfers; retain the application's send/drop policy.
- Put status transitions inside stable geometry. Preserve at least 44px touch targets and a usable visible action on touch devices. Do not move the message text when an icon changes.
- Clean up timers and async listeners. Honor reduced motion. Pointer decoration cannot be the sole focus indicator or an extra focusable element.
- Inspect any additional upstream component before reuse: the gallery contains simulated stage sequences and dependencies unsuitable for some applications. Do not install an entire styling or animation stack to reproduce one interaction.

For glass/shader work, this library handles controls, not rendering. Use the available `liquid-materials` skill if relevant; otherwise keep a static surface. Decorative activity must not masquerade as network progress.

## Verify and stop

Exercise the integrated primitive with keyboard and touch-sized layouts, a real success path, and the applicable failure path. Check that interaction state remains authoritative and reduced motion works. Stop after the requested component works in context; do not import the rest of the gallery.
