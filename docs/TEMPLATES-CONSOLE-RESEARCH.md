# Templates, free models and a developer console

Reviewed 2 November 2026. This document separates implemented work from candidate integrations. Research included the five supplied X threads, their linked repository READMEs, the existing Chucksi code and current provider documentation. Third-party claims below are not Chucksi benchmarks.

## Implemented in this release

- Website library expanded from **17 to 32 editable templates**, all with motion enabled. That is a count of starter designs, not customer websites. Motion ranges from reveal/parallax to dedicated animated heroes; it does not mean all 32 contain a background video.
- **13 hero layouts** represented in the library. Three new layouts: kinetic type with animated bars, layered image cards with pointer movement, and a horizontally scrollable film strip. Existing reduced-motion and offscreen controls apply.
- Fifteen original demo concepts: Fern, Haven, Margin, Frame, Signal, Northline, Fieldwork, Index, Folio, Form, Common Table, Orbit, Echo, Vow and Still Life. Different copy, structure, typography, palette and imagery selections; the existing original image library is reused.
- New screenshots and short scroll-preview films for each new template, also discoverable in Workflows. Preview films are made from browser screenshots, not recordings of live animation. Provenance is in `public/media/templates/provenance.json`.
- `/console/`: searchable catalog, actual GET request playground, copyable agent brief and API specification.
- `GET /api/v1/templates?kind=business` lists public metadata; `GET /api/v1/templates/{id}` returns an editable site specification. Read-only, no generation charges, no account data, no publishing access. `GET /api/v1/openapi.json` documents these endpoints.
- Existing signed-in publishing, project ownership checks and generation limits are preserved. This release adds no new paid provider calls.

Not implemented in this release: a model-backed website designer, public generation API keys, remote MCP/OAuth, the `console.chucksi.com` domain alias, or the video repositories listed below as runtime dependencies. The console is live at the main site's `/console/` path after deployment.

## Can free models help?

Yes: translating a brief into a site plan, selecting a template, revising a section, suggesting original copy, and reviewing a screenshot are good bounded tasks. The current website writer is deterministic (`templateSite()`), so changing a provider alone cannot make it an agent. Build the editing contract and validation loop first.

| Service | Useful role | Limits / implications |
| --- | --- | --- |
| Cloudflare Workers AI | Default small, structured editing requests using an existing integration | 10,000 Neurons/day free allocation shared by the account. On a paid plan usage above it is charged. Some frontier models require a billing method. A public free product needs its own aggregate cap and queue. |
| OpenRouter free model variants | Secondary route and model evaluation | Free routes have daily and per-minute limits and provider availability constraints. Read the key's current `free_model_daily_requests` counter rather than assuming every visitor receives a new quota. |
| `openrouter/free` | Experiments or a fallback when predictable style is less important | Chooses a compatible free model at random. This is not a quality ranking or a consistent coding-agent identity. |
| Browser / deterministic renderer | Template browsing, editing, motion, previews, local exports | No model inference needed. This is the reliable free foundation, including when hosted inference is exhausted. |

Sources: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits), [free router behavior](https://openrouter.ai/docs/guides/routing/routers/free-router). Free API access and an open model license are separate checks. Do not assume a zero-price route grants rights to weights or code.

Candidate evaluation: compare the existing Llama baseline with the available Qwen coding/vision option and two currently free OpenRouter candidates. Resolve IDs, prices, structured-output support, provider privacy and license at evaluation time; freeze the passing versions in an explicit allowlist. Cloudflare's [Qwen 3.8 27B release](https://developers.cloudflare.com/changelog/post/2026-08-17-qwen-3.8-27b-workers-ai/) is a candidate to evaluate, not a claim that it is the best model for Chucksi. No provider benchmarks or new inference were run in this release.

### Verified free-route shortlist

The [public OpenRouter model catalog](https://openrouter.ai/api/v1/models), checked on 2 November 2026, listed zero prompt and completion prices for these candidates:

| Model ID | Suggested evaluation task | Catalog support |
| --- | --- | --- |
| `cohere/north-mini-code:free` | Targeted code and section edits | Text, tool calling; no structured-output flag listed, so validate responses locally. |
| `xingchen-agi/xing4.0-29b-a4b:free` | Brief → structured site plan | Text, tools, structured outputs. |
| `nvidia/nemotron-3.5-super-vl:free` | Screenshot critique and mobile review | Text/image/video inputs, tools, structured outputs. |

These are availability and capability checks, not quality benchmarks or completed integrations. Confirm each model's own license and provider data policy before production use. Pin only passing candidates, recheck route pricing, and enforce a zero-price policy before each request. Other models with zero text token prices may charge for media output, so a numeric filter alone is insufficient.

### Quality loop to build next

1. A short brief records business, audience, goal, content, imagery and preferred motion. Select 2–3 relevant curated starting points.
2. A planner proposes a page/section structure in the existing schema. A designer proposes theme and layout edits. These are bounded stages, not a collection of autonomous agents with unrestricted code execution.
3. Sanitize the patch; show a diff and retain the previous version. Avoid replacing the entire site for a one-sentence edit.
4. Render desktop and 390px mobile previews. Check overflow, missing images/fonts, contrast, heading order, focus behavior, broken links and reduced motion.
5. A visual reviewer scores hierarchy, specificity, image/copy fit, spacing and mobile usability. One targeted repair pass, then fall back to a known-good template if checks still fail.
6. Publish only from the signed-in owner after the existing readiness check. Do not represent an unconnected form, checkout or booking link as functional.

Evaluation set: at least 20 fixed briefs across local services, restaurants, artists, portfolios, events, product launches and education. Score validity, content relevance, visual quality, mobile behavior, edit preservation, time and cost. Promote a model only when it improves these outcomes; keep a regression set of past failures.

Cost control: enforce both account-wide and per-user reservations before inference, restrict output length and retry count, cache reusable design planning, and never fall back automatically to a paid model. Visitors keep browsing, editing and exporting if inference is unavailable. For heavier usage, a user-supplied key or sponsored compute is optional, not a prerequisite for basic editing.

## Findings from the supplied X threads

### 1. Tilt to peek

[Thread](https://x.com/monoradio102/status/2116746974716432602) → [monoradio102/tilt-to-peek](https://github.com/monoradio102/tilt-to-peek).

A 360-degree orbit video is scrubbed using phone tilt or dragging to simulate depth. It is not a reconstructed 3D scene. The repository references MiniMax H3 and an orbit LoRA. No root license was found in the reviewed repository, so its code/assets were not copied.

Chucksi adaptation: an original video-scrub viewer for a user's own orbit clip, with drag/keyboard fallback, optional tilt permission after a tap, and reduced-motion behavior. Pair it with an orbit preset after the resulting frames pass a continuity check. Do not make tilt permission necessary to view a template.

### 2. Animated short studio

[Thread](https://x.com/RoundtableSpace/status/2117236532482396349) → [mromidev/claude-animated-shorts](https://github.com/mromidev/claude-animated-shorts).

A staged workflow for vertical animated shorts: script, voice, shot plan, character frames, 2D cutouts in a 3D scene, composition and frame review. Code/docs are MIT; reference images have separate study-only context. Its use of Remotion still requires checking Remotion's own licensing for our deployment.

Chucksi adaptation: an editable shot list with character reference locking, voice timings, per-shot rerender and a final continuity review. Preserve a project manifest so a user can fix one shot without rebuilding the whole film.

### 3. Pixel interactions

[Thread](https://x.com/AmirMushich/status/2116509069477621819) → [amirmushichge/pixel-plays](https://github.com/amirmushichge/pixel-plays).

Browser-native isometric scenes with software rasterization, dither and one-action gameplay. Code is MIT, but music is explicitly excluded and governed by its own notice. Use the interaction pattern or code only with the relevant notices; replace music with owned audio.

Chucksi adaptation: a playful landing-page hero that is genuinely interactive, alongside an ordinary accessible call to action. Keep mobile input simple and provide a static fallback. The linked brand-system skill is a design-process reference, not a dependency added here.

### 4. Video editing agent

[Thread](https://x.com/Machinedelusion/status/2116668287656333409) → [Tencent/WeVisCut](https://github.com/Tencent/WeVisCut).

A 9B policy and a tool-driven sequence from article/story to shots, audio/assets, composition, judging, reflection, probing and stitching. Its own published code/weights are Apache-2.0 according to the [license](https://github.com/Tencent/WeVisCut/blob/main/LICENSE), with separately licensed dependencies. The README's roughly 24GB bf16 requirement and token-efficiency claims were not benchmarked here.

Chucksi adaptation: use our owned media library, model adapters and render jobs behind an inspectable timeline. Add per-shot undo and bounded critique/repair. Do not automatically import arbitrary web footage into customer projects. Evaluate this as a GPU worker separately from website generation.

### 5. Ten open motion/video resources

[Thread](https://x.com/socialwithaayan/status/2116567606882967790). Primary repository documentation reviewed:

| Repository | Useful idea | License / recommendation |
| --- | --- | --- |
| [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) | Style-directed code animation; numerous visual directions | MIT code, CC BY 4.0 creative material. Prompts target Opus; not evidence that a free model produces the same output. Evaluate. |
| [OpenFilm](https://github.com/openfilm/openfilm) | Editable `film.html`, clip tracks, deterministic `frame(t)` rendering, local studio/history | MIT. Strong first integration candidate. Render untrusted scene code in isolated jobs; audit dependencies. |
| [ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill) | Probe → edit → verify; captions, sound, trims and reframing; MCP tools | MIT. Strong candidate for reliable finishing tools; constrain file access and commands. |
| [anything2explainer](https://github.com/Vincentwei1021/anything2explainer) | Script-to-visual explainer structure and timed narration | PolyForm Noncommercial. Exclude as an open-source production dependency without separate permission. |
| [FreeVideo](https://github.com/FlashML-org/FreeVideo) | Hardware-adaptive local video generation and preview/finish passes | Apache-2.0 code. Evaluate model license, worker image and actual cost/quality separately; 8GB claims are not a Chucksi benchmark. |
| [ManimGX](https://github.com/academa-labs/manimgx) | GPU math/science animation through a familiar Python API | MIT. Good specialist educational-video route, not the main website designer. |
| [video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | Motion cards and voice-to-animation timing | PolyForm Noncommercial. Design study only for this project. |
| [huashu-motion](https://github.com/alchaincyf/huashu-motion) | Three visual directions, then point-to-edit feedback with frame/time/element context | MIT core; GSAP and fonts have their own terms. Strong workflow idea for targeted edits and undo. |
| [motion-video-kit](https://github.com/echris6/motion-video-kit) | Independent visual critique and measurable motion-quality checks | MIT. Strong evaluation/process candidate; film study references are not redistributable footage. |
| [motionmaxxing](https://github.com/Tejashmakwana/motionmaxxing) | Measured easing, render validation and brand-to-motion planning | Apache-2.0. Evaluate quality gates and original reusable motion recipes. |

No third-party video code, music or reference footage was copied into this release. New template layouts use the existing Chucksi renderer and original code.

## Developer platform path

The supplied Higgsfield screenshots illustrate useful structure: model/tool discovery, a real playground, a quick start, connection help and usage visibility. We implemented the first catalog/playground slice rather than presenting fake key management or an unimplemented connection button.

Next stages:

1. **Public catalog (implemented):** read-only template metadata/specs and OpenAPI; can be used by any assistant that supports HTTP.
2. **Read-only MCP:** expose `list_templates`, `get_template`, `list_workflows` over the supported Streamable HTTP transport. Validate inputs and return structured content. Test with an actual MCP client before advertising installation.
3. **Account tools:** Supabase-backed identity, OAuth authorization for the client, short-lived/scoped grants and owner checks for `create_draft`, `list_projects`, `get_job`. API keys should be stored hashed, shown once and revocable; never reuse provider keys as public keys.
4. **Generation tools:** same shared queue, idempotency and cost reservations as the website. `generate_video` creates a job; `get_job` polls; private output uses owner-scoped access. MCP calls cannot bypass browser limits.
5. **Publishing:** retain account ownership and explicit publishing intent. Preview-first, with clear returned URL and rollback. Keep user-generated sites isolated on the hosting domain already used by Chucksi.
6. **Console domain:** point `console.chucksi.com` to the console once a dedicated route and login callback behavior are tested. No DNS change is part of this release.

Cloudflare's [remote MCP guidance](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) is the implementation starting point. The API contract and account model must be shared by browser, REST and MCP; separate unchecked implementations would create inconsistent limits and permissions.

## Next build order

1. Model-assisted section editing with diff/undo and the quality evaluation suite.
2. Original orbit-clip scrub viewer and more validated hero/preset combinations.
3. OpenFilm/FFmpeg proof of concept: one user-owned product story → editable scenes → timed voice/captions → reviewed MP4.
4. Shot continuity and point-to-edit workflows.
5. Authenticated MCP and generation API, then console domain and real usage history.

These are proposed next builds, not promises that the reviewed third-party systems are already running in Chucksi.
