# Website Studio upgrade — 2026-11-01

This pass improves the first few minutes of building a website. It does not claim feature parity with Wix, GoDaddy or Framer.

## Built

- Three complete original starters: Stillform (movement studio), After Hours (music artist), and Lake & Light (illustrative property).
- Fourteen searchable templates, grouped by the visitor's goal.
- A three-step entry path: pick a design, personalize it, then review and publish.
- Name, introduction and public contact-email customization, with the editor's existing undo support.
- A launch review for unfinished content, missing contact routing and incomplete buttons; shortcuts to phone preview and settings.
- Six new original generated photographs, responsive WebP variants, and actual-template thumbnails.
- Three website workflow cards with lightweight scroll previews of the real rendered templates.
- Failed local draft saving now stops sign-in navigation. An expired session returns publishing to the sign-in gate before export or upload.

## Account and hosting behavior

Visitors can experiment and export locally without an account. Publishing a hosted subdomain requires a signed-in, verified account. The existing server validates the bearer token and ownership for site creation, updates and deletion; the restriction is not just a disabled button. Hosted addresses use `<slug>.v2web.site`.

The server gate was already present. This pass adds regression coverage for anonymous, invalid-token and unverified update/delete attempts, and strengthens the editor's save-before-sign-in behavior. It does not modify the hosting service or account permissions.

Drafts are still stored on the device. Contact forms open the visitor's email application; they are not a lead database or a booking system. Property imagery and figures are illustrative and require replacement with verified listing information.

## Comparison and next work

Reviewed the official product pages on 2026-11-01:

- [Wix AI website builder](https://www.wix.com/ai-website-builder): conversational setup plus business tools. The useful benchmark is reaching a functional business website, not merely producing a hero section.
- [GoDaddy website builder](https://www.godaddy.com/websites/website-builder): guided setup and connected marketing/business workflows. Chucksi should make the visitor's next action equally clear.
- [Framer AI](https://www.framer.com/ai/): prompt-driven design followed by direct visual refinement. Chucksi should preserve this kind of control and reversibility.

Recommended implementation order:

1. **A real AI editing conversation.** Add a dedicated site-generation endpoint using an available open model. Validate structured site changes against the existing schema, preview the changes before applying, preserve manual edits, and make each operation undoable. Offer focused actions such as “rewrite this section,” “make the layout more editorial” and “add a services page.” The current writer assembles templates; do not market it as an unconstrained AI designer. Avoid reusing the Office question-answering endpoint and its unrelated system prompt.
2. **Account-owned projects.** Sync editable project documents and media through Supabase with owner-only row policies, version history and a clear local-to-account migration. Keep export available, handle conflicts, and never overwrite a newer project silently.
3. **A working enquiries workflow.** Add a lead inbox, spam protection, submission confirmation and notification preferences. Then add genuine appointment availability and booking management. Until these exist, label email enquiries honestly.
4. **More complete industry kits.** Build five polished, functional kits around specific outcomes: local service quote, restaurant visit, portfolio enquiry, artist booking and event registration. Each needs coordinated pages, imagery, copy, contact routing and mobile checks, rather than another color variation.
5. **Launch confidence.** Expand review to image descriptions, contrast, broken destinations, social cards and performance. Add analytics and custom domains once ownership and project recovery are dependable.

## Validation

- Desktop and 390 px phone inspection of all three starters; no sideways page overflow.
- Search, goal filters, personalization, undo, review and sign-in gating checked in the editor.
- Workflow card navigation opens its matching starter; visible preview videos load with no media errors.
- Unit coverage exercises personalization preservation, search combinations, incomplete links/contact routing, draft-save failures and expired-session publishing.
- Hosting integration coverage rejects anonymous, invalid-token and unverified writes without changing the existing site version.
- Full repository check: `npm test` passed all 199 tests on 2026-11-01. `git diff --check` also passed. No browser automation dependency or third-party template runtime was added.

## Images and previews

The six photographs were created with ChatGPT's built-in image generation, in generate mode with an opaque background. They are original fictional illustrations, not photographs of an actual artist, studio or listing. Only resizing, cropping and WebP compression were used after generation. Exact prompts and source filenames are in [website-studio-image-prompts.json](website-studio-image-prompts.json).

`public/media/website/studio-provenance.json` records the packaged photo hashes. The main website provenance also records the new photos. Template thumbnails and workflow loops depict the templates themselves. Browser screenshots were captured through CUA; `tools/package_website_studio_previews.py` turns the complete-page screenshots into six-second forward/back scroll previews. No external footage or paid video API was used for these loops.
