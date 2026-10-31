# Framer, reverse-engineered for Chucksi

Clean-room notes: Framer publishes Markdown views of its product pages (`?md`) and an `llms.txt` index; the behavior below comes from those public pages, its help center, its updates log and third-party reviews. No Framer code, templates, components, copy or assets were copied. We call our feature **Website**; section, theme and effect names are our own.

Research date: 2026-10-30.

---

## 1. Feature map

Value: **H** = the reason people choose Framer, **M** = used by most sites, **L** = advanced or team-only.

| Feature | What users see | How it appears to work | Value | Sources |
| --- | --- | --- | --- | --- |
| **AI site generation** | Describe the site (product, pages, content, CMS collections, reusable components, responsive behavior, visual direction, attached images); an agent creates native pages, navigation, sections, copy, CMS collections, components and breakpoints, then offers next steps ("add tablet and phone breakpoints?"). A model picker sits in the chat. Agent edits cost credits; hand edits on the canvas do not. | An LLM agent with tools that write the project's document model directly (not HTML), so every result stays editable. It plans first ("created a design plan"), then builds section by section. | **H** | [Framer AI](https://www.framer.com/ai/?md), [First-site lesson](https://www.framer.com/academy/lessons/build-your-first-site?md), [AI website builder](https://www.framer.com/solutions/ai-website-builder/?md) |
| **Visual canvas** | Freeform canvas with auto-layout stacks and grids, components with variants and properties, effects (shaders, gradients, glass, particles), interactions (hover, click, tap), variable fonts and OpenType, layer masks, custom cursors, vector drawing, working forms. Reference images or a URL can seed a design. | A design-tool document compiled to React at publish time. | **H** | [Design](https://www.framer.com/design/?md) |
| **Breakpoints** | Desktop, tablet and phone frames (the marketing page shows 1200, 810 and 390 px); "make this responsive" via the agent; per-breakpoint overrides such as hiding a section on phone. | Each breakpoint is a variant of the page with property overrides. | **H** | [Design](https://www.framer.com/design/?md), [First-site lesson](https://www.framer.com/academy/lessons/build-your-first-site?md) |
| **Components and sections** | Reusable components with variants; a marketplace of community components, vectors and plugins; code components in React; code overrides. | Component instances with props; plugins and code components use a documented API. | M | [llms.txt](https://www.framer.com/llms.txt), [Developers](https://www.framer.com/developers/?md) |
| **CMS** | Collections with fields, detail pages, CSV import (the demo imports 39 rows and links a 10-item category collection), bulk updates by the agent. Plan limits: 2 collections on Basic, 10 on Pro, CMS items 1,000 / 2,500. | A typed content store bound to page templates. | M | [CMS](https://www.framer.com/cms/?md), [Pricing](https://www.framer.com/pricing?md) |
| **Animations and effects** | Appear, scroll and hover effects, tickers, parallax; hosting page credits GPU-accelerated transitions to Motion. | Declarative animation props compiled to Motion (MIT, the former Framer Motion). | **H** (the thing reviewers praise most) | [Hosting](https://www.framer.com/hosting/?md), [Limitations guide](https://p0stman.com/guides/framer-limitations) |
| **SEO** | Per-page title and description, CMS variables in titles (`{{Title}}`), social image (1200x630), sitemaps, redirects, uploaded `robots.txt` / `security.txt` / `llms.txt`, Core Web Vitals report, agent SEO audits (metadata, headings, alt text, internal links), Markdown views for AI agents. | Static metadata at publish, plus pre-rendered HTML. | M | [SEO](https://www.framer.com/seo/?md), [llms.txt](https://www.framer.com/llms.txt) |
| **Localization** | Add locales (language plus optional region and a fallback); every string appears in a localization table by page; translate manually or with AI translation (costs credits); Auto Translate keeps locales in sync as content changes; Automatic Locale redirects visitors from the default locale using browser language order and, only when needed, device timezone (no geolocation; bots never redirected; a chosen locale is remembered). Paid add-on. | String extraction per node, machine translation, locale subpaths (`/fr`, `/es-MX`). | M | [Adding a locale](https://www.framer.com/help/articles/adding-a-new-locale/?md), [Automatic Locale](https://www.framer.com/help/articles/how-does-automatic-locale-work/?md), [Auto Translate](https://www.framer.com/updates/auto-translate?md) |
| **Publish and hosting** | One-click publish to a free `framer.app`-style domain or a custom domain with SSL; staging and production; atomic deploys; version history and rollback; password protection; on-page content editing on the live site; global CDN, pre-rendering of popular pages, AVIF/WebP image resizing at the edge, Brotli, WOFF2; a firewall by country and path. | Managed static and edge hosting. | **H** | [Publish](https://www.framer.com/publish/?md), [Hosting](https://www.framer.com/hosting/?md), [Updates](https://www.framer.com/updates?md) |
| **Templates marketplace** | Free and paid community templates (paid ones often $2-129, sold through the creator's own checkout); duplicate into your account. | Project duplication links. | M | [Templates](https://www.framer.com/marketplace/templates/?md) |
| **Collaboration** | Real-time multiplayer, comments, branching with previews, merge to main, roles; free viewers, paid editors ($20/month each). | | L-M | [Collaborate](https://www.framer.com/collaborate/?md), [Pricing](https://www.framer.com/pricing?md) |
| **Analytics, A/B tests, MCP** | Cookie-free analytics, A/B tests (Convert add-on), an MCP server so external agents can edit the canvas, CMS and publish. | | L | [llms.txt](https://www.framer.com/llms.txt), [Updates](https://www.framer.com/updates?md) |

**Pricing context** ([Pricing](https://www.framer.com/pricing?md)): Free ($0, Framer domain, 1 GB bandwidth), Basic ($10/month, custom domain, 2 CMS collections, 50 GB), Pro ($30/month, 10 collections, 100 GB, staging, branching), Enterprise (custom); AI credits on every plan; localization and advanced hosting are add-ons.

**What users value most**: going from a prompt to a published, good-looking site in minutes; animations; one-click hosting with SSL and domains; responsive control per breakpoint. **Pain points** (from a guide written by a migration agency, so read with that bias): AI output is a starting point that still takes about half a day of cleanup and polish; no clean code export, so sites are locked in; CMS weak for complex content; no native e-commerce, accounts or backend; heavy animations can hurt mobile performance ([p0stman guide](https://p0stman.com/guides/framer-limitations)).

The gap Chucksi can fill: a free generator whose output is **plain static files you own**, with art from our own Image tool, and no lock-in.

---

## 2. What Chucksi already has

| Existing piece | File | Reuse |
| --- | --- | --- |
| LLM writes a typed JSON spec, a sanitizer validates it, a no-model template fills in when the cap is hit | `/api/beats` in `src/index.js`, `templateSpec` / `sanitizeSpec` in `public/js/film.js` | Exactly the pattern for `/api/site` |
| Llama 3.3 70B with JSON-schema mode available on Workers AI | `LLM` in `src/index.js`; [JSON mode docs](https://developers.cloudflare.com/workers-ai/features/json-mode/) | Site specs |
| Shot designer and four free image models with caps, plus Pollinations and ComfyUI fallbacks | `public/js/rig.js`, `/api/shot` | Hero art, section images, social preview image |
| Real-ESRGAN upscale job | `gpu/workflows/upscale_esrgan.json` | Sharp hero images at 2x |
| Kinetic type film | `/film` | A launch video for the generated site, same brief |
| ZIP creation in the browser (fflate, MIT) | `public/js/pdf-tools.js` | Site export |
| Fonts with SIL OFL (Big Shoulders Display, Instrument Sans) | `public/fonts` | Default site fonts, safe to redistribute in exports |
| Turnstile pass, per-feature daily caps, AI Gateway | `src/index.js` | `/api/site`, `/api/site-edit` |

Note the site has no build step: vanilla ES modules, libraries pinned on jsDelivr. That rules out React-only editors unless we add a separate build.

---

## 3. Open-source building blocks (licenses verified)

Verified from each repo's LICENSE file on 2026-10-30.

| Project | License | Fit | Verdict | Notes |
| --- | --- | --- | --- | --- |
| [GrapesJS/grapesjs](https://github.com/GrapesJS/grapesjs) | BSD-3-Clause | Framework-free, embeddable, drag-and-drop HTML/CSS editor with blocks, style manager, device preview | **Use directly** (v2 freeform mode) | The only mature permissive editor that drops into a no-build vanilla page. Any hosted "Studio" add-ons from its maintainers are separate products and were not evaluated. |
| [puckeditor/puck](https://github.com/puckeditor/puck) | MIT | React visual editor over a JSON component tree, close to our spec model | Research (needs React and a build) | Its data model (components with typed fields, zones) is a good reference for ours. |
| [prevwong/craft.js](https://github.com/prevwong/craft.js) | MIT | React page-editor framework | Research | |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | Apache-2.0 | Full "Cursor for designers" app (Next.js, Supabase) editing real React code | Research | Too heavy to embed; good ideas for AI editing of selected elements. |
| [webstudio-is/webstudio](https://github.com/webstudio-is/webstudio) | **AGPL-3.0** | Full Webflow-style builder | **Avoid** bundling | Network copyleft would reach our whole site. |
| [silexlabs/Silex](https://github.com/silexlabs/Silex) | **AGPL-3.0** | GrapesJS-based builder | **Avoid** bundling | Use GrapesJS directly instead. |
| [wandb/openui](https://github.com/wandb/openui) | Apache-2.0 | Prompt to HTML/Tailwind UI generator | Research | Useful prompt patterns; we generate typed specs instead of raw HTML for safety. |
| [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy), [stackblitz/bolt.new](https://github.com/stackblitz/bolt.new) | MIT | Prompt to full-stack app running in a WebContainer | **Avoid in production** | Both rely on the WebContainer API, which needs a commercial license for production use in a for-profit setting ([WebContainers](https://webcontainers.io/enterprise)); the `webcontainer-core` repo's MIT license covers only that repo. |
| [BuilderIO/mitosis](https://github.com/BuilderIO/mitosis) | MIT | Write components once, compile to many frameworks | Research (not needed) | |
| [plasmicapp/plasmic](https://github.com/plasmicapp/plasmic) | MIT | Visual builder with codegen | Research | |
| [motiondivision/motion](https://github.com/motiondivision/motion) | MIT | Animation library with a vanilla `animate`/`scroll`/`inView` API | **Use directly** in exported sites | The same lineage as Framer's own animations, permissively licensed. |
| [withastro/astro](https://github.com/withastro/astro) | MIT | Static site framework | Use (optional export target) | "Download as Astro project" for developers who want to keep building. |
| [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | MIT | Utility CSS | Optional | Our sections ship hand-written CSS with custom properties instead, smaller and no build. |
| [decaporg/decap-cms](https://github.com/decaporg/decap-cms) | MIT | Git-based CMS for static sites | Use (v3 export option) | Gives exported sites a CMS without us hosting anything. |
| [tinacms/tinacms](https://github.com/tinacms/tinacms) | Apache-2.0 | Git-backed CMS | Research | |
| [cure53/DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 or MPL-2.0 | HTML sanitizer | **Use directly** | Sanitize any rich text in specs and any HTML imported into GrapesJS. |
| [101arrowz/fflate](https://github.com/101arrowz/fflate) | MIT | ZIP in the browser | Use (already) | |

Models (via Workers AI; prices from the [pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/)):

| Model | License | Use | Neurons |
| --- | --- | --- | --- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Llama 3.3 Community License | Site specs with JSON-schema mode (on the supported list) | 26,668 per M input, 204,805 per M output tokens |
| `@cf/openai/gpt-oss-120b` | Apache-2.0 (`openai/gpt-oss-120b` card) | Cheaper specs and edits; not on the JSON-mode list, so validate and retry | 31,818 per M input, 68,182 per M output |
| `@cf/meta/m2m100-1.2b` | MIT (`facebook/m2m100_1.2B` card) | Localization | 31,050 per M tokens each way |
| `@cf/meta/llama-guard-3-8b` | Llama license (not re-checked here) | Screening generated and user text before preview links | 44,003 per M input |
| FLUX.1 [schnell] and friends (existing `/api/shot`) | Apache-2.0 / OpenRAIL | Section art | existing caps |

A 5-page spec is roughly 1.5k input and 3k output tokens: about 650 Neurons on Llama 3.3, about 250 on gpt-oss-120b. With 10,000 free Neurons a day shared by every tool, `/api/site` needs its own cap (start at 15 a day site-wide, 3 per visitor) and the built-in template fallback.

---

## 4. Our design: the Website page

### Principle

The model never writes HTML. It writes a **typed site spec**; our hand-built section library renders it. That gives us Framer's "everything stays editable" property, guarantees responsive and accessible output, makes abuse much harder (no raw HTML, no scripts, no forms that post anywhere), and keeps each generation to a few hundred Neurons.

### UX flow

1. **Brief** (`/site`): name, what it is, who it's for, tone, pages (Home, About, Menu, Pricing, Blog, Contact...), palette (the Image tool's palettes), dark or light, optional logo and photos.
2. **Generate**: `POST /api/site` returns a spec (or the template fallback fills one from the brief). Image slots carry prompts; the page renders immediately with placeholders, then fills art through `/api/shot` one image at a time within the visitor's cap (or from uploads, or "use my last takes" from the Image reel).
3. **Edit**:
   - Click any text in the preview to edit it in place (the preview frame posts the field path back; the spec updates).
   - Section toolbar: move up/down, duplicate, delete, switch variant (each section type has 2-3 layouts), change image (prompt, regenerate, upload).
   - Theme panel: palette, fonts (OFL fonts only), radius, spacing scale, dark/light.
   - Device toggle: 1280 / 768 / 390 px preview frames; per-device "hide on phone".
   - **Ask to change**: "make the hero split with the photo on the right and add a FAQ" goes to `POST /api/site-edit` with the current spec; the model returns a JSON Patch (RFC 6902 subset: `add/remove/replace/move` on spec paths). We validate the patch against the schema, show a diff summary, apply, and keep undo.
4. **Check**: a built-in audit (no model): missing alt text, contrast below WCAG AA, empty links, title/description length, heading order, image weight.
5. **Export / publish** (see options below).

### Site spec (v1 schema, abridged)

```json
{
  "v": 1,
  "name": "Lumen Coffee",
  "lang": "en",
  "locales": [],
  "theme": { "palette": "amber", "mode": "dark", "fonts": { "display": "Big Shoulders Display", "body": "Instrument Sans" }, "radius": 14, "space": "comfy" },
  "nav": { "logo": { "text": "Lumen" }, "links": [{ "label": "Menu", "page": "/menu" }, { "label": "Visit", "href": "#visit" }] },
  "pages": [
    {
      "slug": "/",
      "seo": { "title": "Lumen Coffee: slow coffee on Pike St", "description": "Single-origin pour-overs and pastries baked at dawn." },
      "sections": [
        { "id": "s1", "type": "hero", "variant": "split", "eyebrow": "Since 2019", "heading": "Coffee that waits for you",
          "sub": "Pour-overs, one cup at a time.", "cta": [{ "label": "See the menu", "page": "/menu" }],
          "image": { "prompt": "a barista pouring a slow pour-over at dawn, 35mm film", "alt": "Barista pouring coffee", "ref": null },
          "effect": "fade-up" },
        { "id": "s2", "type": "features", "variant": "cards", "items": [{ "title": "Single origin", "text": "...", "icon": "leaf" }] },
        { "id": "s3", "type": "gallery", "variant": "masonry", "images": [] },
        { "id": "s4", "type": "faq", "items": [{ "q": "Do you have oat milk?", "a": "Always." }] },
        { "id": "s5", "type": "cta", "heading": "Come say hi", "cta": [{ "label": "Directions", "href": "https://maps.example/..." }] }
      ]
    }
  ],
  "footer": { "text": "© 2026 Lumen Coffee", "links": [] },
  "collections": []
}
```

Section types for v1 (each with 2-3 variants): `hero`, `logos`, `features`, `steps`, `gallery`, `quote`, `stats`, `pricing`, `team`, `faq`, `cta`, `contact` (address, hours, map link, mailto; no form), `richtext`, `footer`. Text fields have length limits; `href` must be `https:`, `mailto:`, `tel:` or an in-site page; icons come from a bundled set; images are generated, uploaded or none.

### Rendering and effects

One renderer, used by the preview and the export: `renderSite(spec) -> { files: { "index.html": ..., "menu/index.html": ..., "site.css": ..., "site.js": ..., "img/...": Blob } }`. CSS uses custom properties from the theme, fluid type (`clamp()`), grid with container queries, `prefers-color-scheme`, and `prefers-reduced-motion`. Effects (`fade-up`, `scale-in`, `parallax`, `ticker`, `stagger`) are a few lines of Motion's vanilla API in `site.js` (or a 1 KB IntersectionObserver fallback), disabled under reduced motion. The preview runs in an iframe with `sandbox` and `srcdoc`, no network, so generated content cannot reach our origin.

### SEO pack (generated, no model)

Per-page `<title>`, meta description, canonical, Open Graph and Twitter tags, a social image rendered on canvas from the hero (1200x630), `sitemap.xml`, `robots.txt`, JSON-LD (`Organization` or `LocalBusiness`, `WebSite`, `FAQPage` from the FAQ section), and an `llms.txt` listing the pages, since that is now a common convention.

### Localization (v2)

Collect every string path in the spec, translate with m2m100 (cheap) or Llama 3.3 (better tone) in batches, write `/es/...` pages with `hreflang` alternates and a language switcher. No automatic redirect by default (a static site can only do it in JS); offer an opt-in snippet that redirects once from the default locale using `navigator.languages`, never for bots, and remembers a manual choice.

### CMS (v3)

`collections` in the spec (`{ id, fields: [{ name, type }], items: [...] }`) render list sections and detail pages at export. CSV import in the browser. For sites that keep changing, export with a Decap CMS config so the owner edits content in their own Git repo.

### Freeform mode (v2)

"Open in freeform editor" loads the rendered HTML/CSS into GrapesJS (BSD-3) in the same page, for pixel-level changes. Freeform pages leave the spec world (no more AI patches for that page); we say so before switching.

### Export and hosting options, with abuse risks

| Option | What it is | Abuse risk | Mitigation | Phase |
| --- | --- | --- | --- | --- |
| **A. Download ZIP** | Static files the user hosts anywhere (Cloudflare Pages, GitHub Pages, Netlify drop), with short step-by-step guides | None for us | — | v1 |
| **B. Astro project** | Same site as an Astro project | None | — | v2 |
| **C. Unlisted preview links** | `https://<random>.<preview-domain>` served by a Worker from R2, for showing a client or a friend | Phishing pages, scam and crypto pages, brand impersonation, malware links, SEO spam, illegal images (uploads), harassment pages | Typed spec only (no raw HTML, no scripts, no forms, no password fields, links validated); a **separate registrable domain** listed on the [Public Suffix List](https://publicsuffix.org/) so one bad page cannot get `chucksi.com` blocklisted or share cookies; Turnstile and per-visitor caps on publish; 7-day expiry; `noindex`; 10 MB size cap; Llama Guard over all text and a brand/login keyword screen; URL reputation checks on outbound links; image screening (Cloudflare's CSAM Scanning Tool on the zone; generated images are already ours); a "report this page" link and a takedown address; only hashed IPs kept, like the existing caps | v2 |
| **D. Permanent hosting and custom domains** | What Framer sells | All of C, forever, plus support load and cost | Not planned. If ever: accounts, verified email, manual review for custom domains | Not planned |

### Abuse model in one paragraph

The dangerous outputs of a site generator are login pages that impersonate a bank or brand, fake shops, and pages that host or link to harmful content. Our three structural defenses do most of the work: the generator cannot emit HTML or scripts, the section library has no form or password input, and anything we host lives on a disposable, separately reputed domain with short expiry. Everything else (moderation models, keyword screens, reporting) is a second layer.

---

## 5. Phased plan

| Phase | Scope | Effort | Cost per use |
| --- | --- | --- | --- |
| **v1** | `/site` page; brief form; `/api/site` with Llama 3.3 JSON-schema mode, sanitizer and template fallback; 14 section types x 2-3 variants; theme tokens; preview at three widths; click-to-edit text, section reorder/variant/delete; images from `/api/shot` or uploads; SEO pack; ZIP export | 2-3 days | about 650 Neurons per generated site (Llama 3.3), images under the existing caps; $0 GPU |
| **v2** | `/api/site-edit` JSON Patch edits (gpt-oss-120b to cut cost, with validation and retry); Motion effects; accessibility/SEO audit; localization; GrapesJS freeform mode; Astro export; unlisted preview links on a separate domain with the guardrails above; "make a launch film" hand-off to `/film` | 4-6 days | edits about 100-300 Neurons; preview hosting: R2 storage and Worker requests within Cloudflare's free tiers at our scale (verify limits before launch) |
| **v3** | CMS collections, CSV import, blog pages, Decap CMS export; a moderated gallery of community site specs as templates (specs are small JSON, so sharing is cheap) | 1 week | $0 GPU; optional Real-ESRGAN upscale of hero art at about a few seconds of GPU each |

### Risks

- **Design quality.** Framer's edge is taste. Ours must come from a small number of excellent hand-built sections, not from the model; budget most of v1 on the section library and the theme system.
- **LLM reliability.** JSON-schema mode is supported for Llama 3.3 but Workers AI does not guarantee schema compliance; always sanitize and fall back to the template.
- **Free-tier contention.** Site generation competes with images, ASR and TTS for 10,000 Neurons a day; caps and the template fallback keep the tool working at $0.
- **Abuse** (above). Start with ZIP export only; add hosted previews only with the separate domain and guardrails in place.
- **Fonts and assets.** Ship only OFL fonts and our own icon set in exports; generated images belong to the user under the image model's terms.
- **Clean-room.** No Framer names, template layouts or copy; our section layouts are designed from general web patterns.
