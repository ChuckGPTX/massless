# Video studio release — 2026-11-02

- Compact creation sidebar, separate Effects and Storyboard, visual example stage and responsive layouts.
- First-frame image upload, prompt persistence, automatic source-frame sizing, MP4 download and local library save. The hosted endpoint follows the first frame despite its requested size hint, so manual aspect and resolution controls are not offered for this mode.
- Status and daily allowance are separate, so quota refresh no longer erases a failure.
- Explicit `managed-wan` route uses Runpod's hosted Wan 2.2 open weights. Text-only prompts create an opening frame using FLUX.1 Schnell, then animate it. No automatic cross-provider retry.
- Original GPU routes remain available for existing tools. Their worker was capacity-throttled during release testing; motion transfer and lip-sync are not verified by the managed video test.
- OpenRouter promo disabled: its stored credential returned “User not found.”

## Operating limits

The existing GenerationLedger checks sign-in, ownership, idempotency, active-job limits, account limits and the shared daily budget before work starts. Managed video reserves 35 cents for a fixed five-second clip; current provider list price is 30 cents. The optional generated first frame has a one-cent accounting allowance. Ambiguous submissions retain their reservation. Input images are served to the provider only through an expiring, random capability; output downloads remain owner-authenticated. No provider credentials go to the browser.

Runpod documentation: https://docs.runpod.io/public-endpoints/models/wan-2-2-i2v

## Deployment

Use `npx wrangler deploy --config wrangler.production.jsonc`. Production continues serving versioned static assets from GitHub, preserves dashboard secrets and existing bindings, and keeps both Chucksi custom domains and hosted-site routes. The separate development configuration still uses local static assets.

## Verification

- 218 Node tests passed, including seven new managed-video tests.
- SQLite Durable Object runtime checks passed (concurrent budgets, idempotency, owner isolation and chunk delivery).
- Provider smoke test completed on the Wan 2.2 endpoint; $0.30 reported cost, 160-second execution plus 27-second queue.
- Live text-to-video completed, played, saved to the local library and downloaded: H.264 MP4, 960×960, 5.37 seconds, 730,224 bytes. Download recovery reused the completed job without generating again.
- Desktop and 390px mobile screenshots captured; mobile had no horizontal overflow.
- Production end-to-end verification recorded separately in the release output directory.
