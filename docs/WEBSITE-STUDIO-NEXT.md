# Website Studio: research and next release

Reviewed 2026-11-02. This is a local implementation and roadmap, not a claim of full competitor parity or a production release.

## What changed locally

- Three original complete templates: Aural (floating product), Current (editorial studio), Nightjar (cinematic image wall). The catalog now has 17 templates.
- Original generated hero images, with prompts and provenance retained. Supporting images reuse our own bundled photography.
- Two reusable hero variants: `object` and `mosaic`. Fine-pointer motion, offscreen/hidden pause, reduced-motion and no-JavaScript fallbacks. Shared renderer and runtime for editing, export and hosting.
- Gallery cards open a detail preview before choosing a design. The single player unloads on close and respects reduced-motion/data-saving preferences. Strict draft saving must succeed before replacement; closing/changing the preview cancels a pending replacement.
- Actual Chrome recordings packaged into three six-second gallery previews. Recorded timing is preserved; the final frame is held where the page stops changing. No synthetic animation or borrowed footage.

## Findings that change the plan

| Product | Documented workflow and distinction | Chucksi lesson |
| --- | --- | --- |
| [GoDaddy](https://www.godaddy.com/help/which-godaddy-website-builder-do-i-have-42917) | Classic Websites + Marketing differs from conversational Airo AI Builder. Domains, publishing and business operations are central. | Finish the complete customer journey, not just a pretty first draft. |
| [Wix Harmony](https://support.wix.com/en/article/wix-harmony-editor-about-the-ai-tools) | Aria and direct visual editing share the design workflow; business features are integrated. Harmony is distinct from Studio. | AI and manual changes must edit the same document. |
| [Lovable](https://docs.lovable.dev/features/subagents) | Conversation, planning/building, preview and operational tools; documented read-only subagents support investigation. | Scope edits, retain history and distinguish discussion from mutation. |
| [Base44](https://docs.base44.com/documentation/managing-app-data/testing-agent) | Builder, in-app and testing agents have different roles. Visual app editing connects to managed data. [Export limits](https://docs.base44.com/documentation/building-your-app/developer-tools) still matter. | Add testing and data workflows while preserving independently deployable static output. |
| [Bolt](https://support.bolt.new/building/agents) | Plan/build workflow with Standard/Max agents and preview-based iteration. | Explain intended changes and show the result, errors and recovery together. |
| [Framer](https://www.framer.com/help/articles/how-to-use-agents/) | Agents can work on the actual canvas and scoped elements. | Selection-aware edits should coexist with strong typography, responsive controls and reusable motion. |
| [Webflow](https://help.webflow.com/hc/en-us/articles/38840145286035-Build-a-site-with-Webflow-s-AI-site-builder) | AI onboarding establishes site structure; visual design, CMS and operations continue afterward. | Let people approve page structure before spending time polishing it. |
| [v0](https://v0.app/docs/design-mode) | Visual selection and prompt iteration complement code-based building. | Use a clear selected-element scope and small reviewable changes. |

These are public UI observations and official documentation, not an audit of proprietary internals or a paid end-to-end trial of every builder. The number and internals of undocumented agents remain unknown.

## Design studies

Reviewed [Recent](https://recent.design/websites), [Augen](https://augen.pro/), [Shopify Design](https://shopify.design/) and [Nothing to Watch](https://nothing-to-watch.port80.ch/). Transfer the composition patterns: confident hierarchy, dominant objects, image-wall depth and clearly scoped navigation. Our templates use original names, copy, images and code; they are not pixel-for-pixel copies.

Shopify Design's hero stayed blank in this review session while page structure was available. This is a bounded observation, not a general outage claim. Meaningful content must remain visible without animation.

Nothing to Watch's [license](https://github.com/gnovotny/nothing-to-watch/blob/main/LICENSE) has exceptions: shaders are CC BY-NC-SA 3.0 and film data/media have separate terms. Do not import that visual engine under an assumption that the entire repository is MIT.

## System to build next

Keep the current vanilla editor and typed `SiteSpec` renderer. Current website generation is deterministic template assembly, not a model-driven design agent. Add a real model behind a narrow, validated editing interface.

1. **Brief → structure → art direction.** Collect purpose, audience, pages, primary action and brand assets; propose page structure and three coherent directions. Preserve editable design tokens and original asset prompts. Acceptance: a small service business, creative portfolio and product launch all produce complete, responsive starting points with no fabricated testimonials or business facts.
2. **Selection-aware AI editing.** A planner proposes scoped operations; design/content tools return typed patches. Validate schema, selected scope and document revision, render a before/after preview, and apply through the same mutation/undo pipeline as manual edits. Acceptance: “shorten this heading” changes only that heading; undo restores it; invalid/stale patches leave the document intact. Do not expose arbitrary HTML/JavaScript or reuse the Office-specific assistant route.
3. **Cloud website documents and revision history.** Store versioned specs/assets with project ownership; local-first autosave remains usable offline. Detect conflicting edits, publish an exact reviewed revision and support rollback. Existing project tables are not equivalent to complete website-document synchronization. Acceptance: reopen on another device, recover unsaved work and restore a previous published version.
4. **Working business workflows.** Replace mailto-only forms with a lead inbox and delivery status. Add verified connectors for bookings, checkout and email. Clearly show connection requirements. Acceptance: a real submitted test inquiry reaches the correct owner; another account cannot read it; failures are visible; business functionality matches the preview.
5. **Optional app mode, only when needed.** Isolated execution, separate origins, secret boundaries, resource limits, logs and rollback for projects beyond static SiteSpec. Research [Cloudflare VibeSDK](https://github.com/cloudflare/vibesdk), [Puck](https://github.com/puckeditor/puck), [GrapesJS](https://github.com/GrapesJS/grapesjs) and [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) as architecture references. Puck requires React integration; bolt.diy's WebContainer dependency has separate commercial terms. These do not justify an immediate rewrite.

## Verification and release dependency

- 211 automated tests passed, including template schemas, hosting validation, exports, media budgets and preview lifecycle checks.
- Local Worker runtime tests passed for concurrent idempotency, budgets, owner isolation and chunked delivery. These do not constitute a production deployment test.
- Browser checks: desktop and 390px phone layouts without sideways overflow; all hero images loaded; Nightjar mobile menu opens; reduced-motion stops decorative animation; canceling the design dialog preserves the draft; Use this design applies the selected template; preview video plays; publishing requires sign-in.
- Three actual recordings and desktop/mobile proof captures are retained in the workspace research output.
- **Deploy Worker and frontend together.** `public/js/website/runtime.js` is imported by `src/sites.js`, which validates hosted runtime content and CSP. Static assets alone are insufficient. Verify editor preview, export, account-gated publishing and hosted output after rollout. No production deployment was made in this pass.
