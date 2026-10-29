# Product and design rules

## Design before the affected feature

Tie the change to a user need and acceptance criteria. Review available product/design sources and record unresolved assumptions. Research and design can progress in slices alongside engineering once the applicable contracts are stable.

Link feature/acceptance IDs and the approved design/spec revision from the [feature index](../../product/README.md). A brainstormed design becomes governing scope only through the [specification rule](specifications.md); apply its comparison/decision boundary before replacing accepted user paths or another contributor's design contract.

A feature's design handoff includes:

- User goal, actor/capability, task flow, navigation, and requirement references.
- Applicable wireframes/annotated screens, component/token versions, product copy, and data/API fields.
- Loading, empty, success, error, denied/revoked, stale, offline, conflict, cancellation, and consequential-confirmation states as applicable.
- Responsive and supported-platform variants, keyboard behavior, focus/announcements, and verification plan.
- Ownership, audience, authority, exact-version and evidence/freshness explanations.
- Prototype findings, accepted decisions, and remaining limitations when those activities are part of the scope.

Do not block an approved slice on unrelated future designs. Material behavior changes update the design contract and linked implementation/verification work.

## Shared product experience

Use one approved design system and shared web/desktop feature behavior. Native differences are intentional and documented. Logos/explorations or historical dimensions are not automatically approved final assets.

The graph must have a usable keyboard/list alternative. Distinguish private, draft, approved, published, external, and derived work through clear text/shape as well as color.

Show actual save, provider, source, permission, and compatibility states. Never disguise an unavailable API with fake live content. Label synthetic samples and planned capabilities.

## Accessibility and design review

Target WCAG 2.2 AA for supported primary flows. Use semantic controls, visible focus, readable errors, contrast, zoom/text scaling, accessible names, and reduced motion. Include relevant user/assistive interaction review; static mockups do not prove runtime behavior.

Visible changes include safe screenshots or a recording, relevant viewport/state evidence, and implemented design review. Compare actual behavior with the approved flow and record deviations/limitations.

Keep real customer content, participant identities, private addresses, credentials, and raw research outside public designs and PR artifacts. Follow [security](security.md) and [verification](verification.md).

[WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Accepted application design and UI honesty

- Follow `DESIGN.md` for the accepted 23 October Island system: graphite tones with one violet accent (active place, primary action, AI work, focus only), sage/amber/coral/blue status colours with visible labels, floating navigation/status/detail islands and the morphing status island. Authentication/onboarding retain their original Living Archive appearance. Share the semantic tokens in `packages/ui/src/styles/island-shell.css` across tabs rather than creating divergent feature palettes. Use locally bundled Inter Tight headings and Inter body (6px chips, 8px controls, 12–16px islands). Keep semantic colour labels and contrast.
- Keep My Work as the established-member preview entry screen and a useful Knowledge Pane that starts collapsed without an empty control rail. Graph-first composition applies to the planned graph home; the current preview has no live graph screen. No decorative analytics, rainbow decoration, gradients, pill-everything redesign, or unapproved brand replacement.
- Preserve obvious sample-data and planned-feature labeling. Demo data must never mix invisibly with real organization data; unavailable actions cannot pretend to work.
- The selected workflow in `.impeccable/config.json` is direct code implementation. Mockups/generated concepts do not establish shipped behavior or replace visual verification of the application.
- Use accessible semantics, keyboard navigation, visible focus, contrast, non-color ownership/status cues, reduced motion, and a navigable alternative to canvas-only graph interaction.
- Verify responsive layouts against available content width as well as viewport breakpoints, zoom/scaling, long content, loading/empty/error/no-access states, and both web/desktop when shared UI changes. Preserve private drafts across note selection and workspace navigation; editing-field focus and active-navigation hover contrast require explicit checks. Avoid making privacy status dependent on a hover tooltip.
- `brand/*-exploration*` contains explorations, not approved final assets. Preserve existing work; adopting a final mark is a separate decision.
