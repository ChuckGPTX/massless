# Studios, Showtime and motion-first Explore

This release leads with a Showtime music-video preview, native LiDAR and Vanish effects, live browser demos and distinct starting pages for Image, Video, Audio, 3D and Office. The application code remains MIT licensed. Model weights, user artwork and commissioned media have their own rights and licenses.

## What ships

- The navigation labels open `/studios/image/`, `/studios/video/`, `/studios/audio/`, `/studios/3d/` and `/studios/office/`. Separate arrow buttons open Features and Models menus. Existing workspaces and deep links continue to work.
- Five different visual directions: an image gallery, Showtime screening room, audio listening space, live 3D playground and a paper-inspired document studio. Each includes multiple examples and direct links to working tools.
- Two new wrestling-ring Showtime clips: a Kling 4.0 animated performance and a Genjutsu Light photo-based motion transfer using that performance. The project owner supplied the performer photo. Published audio is an original Chucksi instrumental, not the artist's recording or vocals.
- A local Music Preview tool at `/music`: artwork and audio upload, artist/title, tempo and color controls, landscape/portrait/square layouts, sound playback, seeking and H.264/AAC MP4 export. Audio up to 60 seconds stays on the device. The cut grid follows the user-set tempo; the waveform follows measured audio energy. Automatic beat detection is not claimed.
- Four new original camera-scene artworks. All 28 camera presets now have distinct scene artwork: seven existing motion clips and 21 illustrative stills. Selecting a move retains the user's current input image.
- Form & Field at `/demo-site/`: a responsive editorial website study with three images generated through Chucksi's own Image tool, project details, section navigation and image-prompt remix links. This is a small working website example, not an AI website builder.
- Original browser demos: a rotating 3D projection and the playable Orbit arcade game. Orbit is a small game, not an AI game studio.
- Existing LiDAR, Vanish, freeze and clone effects remain available. LiDAR is a visual effect based on estimated depth, not a physical scan.
- Customer-facing infrastructure labels are simplified, including “Full object” and “Reconstruction service.” Technical setup remains in developer documentation.
- The requested preview-pause control and visible “reference” card badges are removed. Model credits and honest media descriptions remain in the details. Offscreen/hidden-tab pausing, reduced-motion preferences and data-saver defaults remain automatic.

## Media boundary

The six earlier commissioned gallery clips and the two Showtime clips are optional pre-rendered showcase media. Kling, Wan 3.0 Prime, Genjutsu Light and Marketing Studio are not described as open-source implementations. Their outputs are not demonstrations of the current Chucksi generation models. No proprietary generation API is added to the runtime.

See [asset provenance](asset-provenance.md), `public/media/showcase/provenance.json`, `public/media/music/provenance.json`, `public/media/website/provenance.json` and `public/media/art/new-studies-provenance.json` for prompts, settings, attribution and checksums. Original downloads are retained outside the repository. One earlier lunar-rover request could not be recovered from the provider's request history and is excluded from the gallery.

## Next development priorities

1. **Audio-reactive music video:** evaluate an image + song + video workflow with ACE-Step and LTX, using fixed inputs, duration limits and quality comparisons. Review each weight/adapter license separately; LTX weights use a custom community license. The published ComfyUI workflow is inspiration, not a workflow we have validated on this account.
2. **Editing and finishing:** word-level caption alignment, editable transcript cuts, speech cleanup and stem separation. Preserve originals and export editable decisions.
3. **Image editing:** masked inpainting, background replacement and upscaling with one license-checked model and a repeatable evaluation pack.
4. **Video and character consistency:** open-weight image-to-video, controlled pose/motion and reproducible seeds; distinguish independent subject motion from camera animation over a still.
5. **3D, websites and games:** improve reconstruction imports, add scene export, turn the website study into a section editor, and expand reusable game templates after the basic examples are reliable.

Sources: [ComfyUI audio-reactive workflow](https://comfy.org/hub/workflows/image-song-audio-reactive-video-977fefa2b934/), [ACE-Step code license](https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE), [LTX-2 weight license](https://github.com/Lightricks/LTX-2/blob/main/LICENSE).

## Cloudflare + Runpod

Keep the site, authenticated submission, limits and job status on Cloudflare; run long model jobs asynchronously on Runpod. Use transactional job/ownership and budget reservations (D1 or Durable Objects), R2 for large media with bounded signed access, and explicit retries/idempotency. Current KV counters are best-effort request limits, not a guaranteed spending ceiling.

Pin worker images, model revisions and workflow JSON. Record prompt, seed, dimensions, execution time, cost and artifact checksum. Support cancel, retry and download without rerunning successful work. Start with scale-to-zero and a concurrency cap. The browser handles homepage effects, games and scrolling demos without rented inference hardware. No Runpod resource was provisioned in this release.

## Release and validation

Production retains the existing GitHub-backed Cloudflare Worker architecture. Merge the reviewed source and assets to `main`, then upload `src/index.js` with the existing bindings, secrets, limits and observability preserved. `ASSET_REF=main` resolves to a commit for each page; the existing short ref-cache can delay new assets about a minute. Do not accidentally switch this deployment to a new assets binding.

`npm test` covers saved-library retention/failures, preview motion lifecycle, audio analysis and the new Worker routes. Browser checks cover desktop/phone layouts, navigation/menus, video and audio playback, local upload/export, gallery filtering, Orbit controls and website interactions. Exported MP4s are checked for valid H.264/AAC streams. Manual browser checks complement the automated tests; hosted paid inference is not exercised during release verification.
