# Motion Loops, silent exports and ideas from ten posts

Date: 4 November 2026

## The silent lyric videos

Lyric videos exported in Safari (Mac and iPhone) played with no sound. Exports from Chrome were fine: a test tone, the 16-second demo and a 200-second song all decoded with full audio.

**Cause.** Safari's AAC `AudioEncoder` returns a broken decoder description, which [WebKit bug 302253](https://bugs.webkit.org/show_bug.cgi?id=302253) reports as object type 0, 22050 Hz and no channels. An MP4 muxed with that description has a silent soundtrack. The fix landed in WebKit main on 22 October 2026. Safari 27.0.1 still had the bug.

**Fix.**
- **Helper:** `public/js/aac.js` writes the two-byte AAC-LC AudioSpecificConfig itself (ISO 14496-3). It also strips ADTS headers if an encoder ever adds them.
- **Chrome:** Chrome's own bytes are identical, so nothing changes there.
- **Exporters:** all six that write AAC now use it:
  - Lyric Studio and Music Preview (`music-export.js`)
  - Launch Film
  - Film poem
  - Presets
  - Edit-by-text video
  - M4A extract
- **Sound check:** after a lyric export, the file's soundtrack is decoded and checked. If it is silent, the finished screen says so and suggests Chrome.

## What we took from each post

| Post | What it shows | What we did |
|---|---|---|
| Scenario: open-source bouncy motion-graphics loops | 40 shape loops (morphs, bounces, bursts, line draws), each about 30 lines, recolourable by an agent | **Built Motion Loops** (`/loops`): 18 original seamless loops in one self-contained library (`loops-core.js`). Recolour them, then export MP4, PNG or one HTML file. No code was copied. |
| renproton: 22 open-source repos for a motion studio (Remotion, Anime.js, mo.js, Theatre.js, Three.js, RIFE, Auto-Editor and more) | Timeline animation, shape bursts, frame-accurate rendering | **mo.js-style bursts** are now part of the loop library and fire when a chorus line lands in lyric videos. Our engine already renders frame-accurately like Remotion (each frame is a pure function of time). Auto-Editor's silence cutting already exists in Edit by text. |
| Kallaway: the storytelling framework | Hook, then tension, a turn and a payoff | **Lyric pictures** now tell one story with one subject across all scenes, from hook to payoff (scene writer prompt and built-in prompts). **Launch Film** beat sheets follow the same arc. |
| RealMarvelX: 8 web-design resources (MotionSites, Godly, Land-book and others) | Animated, 3D and interactive heroes as starting points | **Website builder** gets six Motion Loop hero layouts (Ripple, Blob, Orbit, Dot wave, Burst, Flow). They use the site's theme colours, respect reduced motion, and the compact runtime adds about 3 KB to exported sites. |
| 0xMarioNawfal: 10 open-source audio repos (AudioCraft/MusicGen, Bark, Demucs, Whisper, RVC, Coqui, Stable Audio, Essentia) | A full open audio lab | We already use Whisper. **Next:** Demucs vocal isolation before transcription, as an option (the htdemucs web ONNX build is 126 MB), and MusicGen or Stable Audio for backing beds. RVC and so-vits-svc are skipped because they clone voices. Essentia is skipped because it is AGPL. |
| Raphael Liu: open-source Higgsfield-style canvas (MIT, ComfyUI) | Node canvas with pluggable providers | Chucksi already runs your own ComfyUI workflow from the Image studio. **Watch:** a canvas view for chaining tools. |
| Tencent Hy-Nomas: interactive video world model (open) | Camera trajectories with world memory, runs on consumer GPUs | **Watch:** a candidate for the "your own GPU" path, like Idol in 3D. It is not runnable on Workers AI. |
| DEXTUNE viz3d: agent skill that turns systems into 3D explainers | OpenStreetMap layouts, a self-review loop on frames | **Idea:** the self-review loop. We already screenshot and check frames before shipping. A built-in "check my video" pass is a candidate. |
| public-apis list (MIT, about 2,000 APIs) | Free data sources for apps | **Idea:** "live data" blocks for websites and games (weather, quotes, events), keyless APIs only. |
| social-media-research-skills (ScrapeCreators) | Viral-post and comment research across platforms | Needs a paid ScrapeCreators key, so it is not built in. It fits a future "research my niche" step for Chuck S.I. if a free data source turns up. |

## Lyric video upgrades in this change

- **Motion Loops on the beat.**
  - Each scene gets a shape loop matched to its look, cycling every four bars.
  - The loop brightens with the bass and on each beat.
  - It sits under the colour grade so the words stay readable.
  - A burst pops as each chorus line lands.
  - You can turn this off with the new **Shapes** setting.
- **Cuts on the music.** Picture changes snap to the nearest bar line, or the nearest beat if no bar line is close.
- **One story.** The pictures keep one subject and one world, moving from a hook through the build and the turn to a payoff.
- **Sound check.** Described in the section above.
