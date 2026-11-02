import { OPTICAL_EFFECTS } from './effect-presets.js';

export const WORKFLOWS = [
  {id:'image-workroom',name:'Image to campaign frame',tag:'IMAGE + DESIGN',image:'/media/website/ceramics.jpg',description:'Reframe an image, adjust its finish and add a headline. Save a new take, ready for motion.',output:'PNG + saved take',steps:[['Choose or create an image','/image'],['Compose a new take','/edit/'],['Use the saved take in your next tool','/library/']]},
  {id:'scene-stage',name:'Objects to a 3D scene',tag:'3D + IMAGE',image:'/media/art/observatory.jpg',description:'Stage real objects and lights, orbit the camera, and export a complete editable scene.',output:'GLB + PNG frame',steps:[['Stage your objects','/scene/'],['Set lighting and camera','/scene/'],['Export GLB or save a frame','/scene/']]},
  {id:'website-template',name:'A studio website of your own',tag:'IMAGE + WEBSITE',image:'/media/website/pavilion.jpg',description:'Describe a site, edit every word in place, add your own images and export a fast static site you can host free.',output:'Static HTML website',steps:[['Create your featured image','/image'],['Describe and edit your website','/website/'],['Preview and export HTML','/website/']]},
  {id:'arcade-template',name:'Describe a playable game',tag:'GAME + DESIGN',image:'/media/art/astronaut.jpg',description:'Describe a game or pick one of twelve, remix its look and difficulty, then export one HTML file to share.',output:'Offline HTML game',steps:[['Describe the game','/games/'],['Play and remix it','/games/'],['Download your game','/games/']]},
  {
    id: "release-teaser",
    name: "Artwork to release teaser",
    tag: "IMAGE + AUDIO + VIDEO",
    image: "/media/art/jellyfish.jpg",
    description:
      "Turn cover artwork and your own track into a beat-synced music video preview.",
    output: "MP4 with audio",
    steps: [
      ["Create your cover", "/image"],
      ["Add your track and sync the artwork", "/music"],
      ["Export the finished teaser", "/music"],
    ],
  },
  {
    id: "product-launch",
    name: "Product to launch film",
    tag: "IMAGE + MOTION + FILM",
    image: "/media/website/ceramics.jpg",
    description:
      "Build a product visual, add a camera move, then assemble a title-led launch film.",
    output: "Camera clip + launch film",
    steps: [
      ["Create a product visual", "/image"],
      ["Animate your saved image", "/video?move=arc-right"],
      ["Build and export a launch film", "/film"],
    ],
  },
  {
    id: "scan-reveal",
    name: "Still to LiDAR reveal",
    tag: "IMAGE + EFFECTS",
    image: "/media/clips/effect-lidar-active.jpg",
    description:
      "Sweep a photo into a point cloud, adjust the duration, and render a short reveal.",
    output: "Video clip",
    steps: [
      ["Create or upload your still", "/image"],
      ["Set up the LiDAR scan", "/video?effect=lidar"],
      ["Render and download the clip", "/video?effect=lidar"],
    ],
  },
  {
    id: "interview-captions",
    name: "Interview to captions",
    tag: "AUDIO + TEXT",
    image: "/media/art/train.jpg",
    description:
      "Transcribe your recording, correct the words and timings, then export a caption file.",
    output: "SRT / VTT + captioned clip",
    steps: [
      ["Upload and transcribe your recording", "/audio?tab=captions"],
      ["Review words and timings", "/audio?tab=captions"],
      ["Burn captions into your video and export", "/cut/"],
    ],
  },
  {
    id: "depth-scene",
    name: "Image to an orbitable scene",
    tag: "IMAGE + 3D",
    image: "/media/art/massless-world-v1.jpg",
    description:
      "Estimate depth from a still, inspect it as a point-cloud scene, and export a PLY file.",
    output: "PLY scene",
    steps: [
      ["Create or upload a still", "/image"],
      ["Estimate depth and explore the scene", "/3d"],
      ["Download the PLY scene", "/3d"],
    ],
  },
  {
    id: "document-pack",
    name: "Documents to a PDF pack",
    tag: "OFFICE + PDF",
    image: "/media/website/lounge.jpg",
    description:
      "Annotate source documents, arrange the pages, and export a practical PDF package.",
    output: "PDF documents",
    steps: [
      ["Annotate your source document", "/office"],
      ["Arrange the PDF pages", "/office?tab=convert&op=merge"],
      ["Review and export the package", "/office?tab=convert&op=merge"],
    ],
  },
];
// One-click design workflows: each opens /workflows?make=<id>, renders at once from bundled sample frames,
// and repaints with FLUX.1 schnell on demand. Thumbnails were rendered with the workflows themselves.
export const makeURL = (id) => "/workflows?make=" + encodeURIComponent(id);
export const DESIGN_WORKFLOWS = [
  { id: "map", name: "Illustrated map", tag: "IMAGE + MAP", image: "/media/make/thumb-map.webp", description: "Name a place. It is painted from straight above, then becomes a map poster with editable labels, legend and compass.", output: "Poster PNG + print PDF", frames: 1 },
  { id: "identity", name: "Brand identity kit", tag: "BRAND + SYSTEM", image: "/media/make/thumb-identity.webp", description: "A name and a vibe become a studio-style identity: wordmark, monogram, palette, type, pattern and six applications.", output: "Board + 7 PNGs + SVG + brand colours file", frames: 0 },
  { id: "film-poem", name: "Film poem", tag: "TEXT + IMAGE + FILM", image: "/media/make/thumb-film-poem.webp", description: "Write a few lines. Each one gets a painted frame, typed-on words and a slow camera move, cut into a 20 to 40 second film.", output: "MP4 / WebM + title card", frames: 4 },
  { id: "poetry", name: "Poetry posters", tag: "TYPE + PRINT", image: "/media/make/thumb-poetry.webp", description: "Set a poem as an editorial poster series: big verse, tiny captions, a strict grid and real scale contrast.", output: "3 to 5 posters + print PDF", frames: 1 },
  { id: "festival", name: "Festival poster series", tag: "EVENT + SOCIAL", image: "/media/make/thumb-festival.webp", description: "Event name, dates and lineup become a two-colour poster series with printed silhouettes, plus feed and story sizes.", output: "Posters + 1080×1350 + 1080×1920", frames: 3 },
].map((w) => ({ ...w, href: makeURL(w.id) }));

// Website templates live in the Website builder (/website?template=<id>). Swap the placeholder thumbnails here
// once the builder ships its own previews.
export const WEBSITE_WORKFLOWS = [
  { id: "editorial-shop", name: "Editorial shop", description: "A shop that reads like a magazine: big product stories, quiet grid, a cart-ready catalogue.", image: "/media/make/site-editorial-shop.webp" },
  { id: "manifesto", name: "Manifesto", description: "One idea, said loudly: a long-scroll statement site with oversized type and numbered principles.", image: "/media/make/site-manifesto.webp" },
  { id: "portfolio-timeline", name: "Portfolio timeline", description: "Your work in order: projects on a timeline with years, roles and big images.", image: "/media/make/site-portfolio-timeline.webp" },
  { id: "ai-product", name: "AI product launch", description: "Launch page for an AI product: crisp hero, demo, features, pricing and a waitlist.", image: "/media/make/site-ai-product.webp" },
].map((w) => ({ ...w, tag: "WEBSITE TEMPLATE", output: "Editable static website", href: "/website?template=" + w.id }));
export function validatePlan(value) {
  if (
    !value ||
    value.version !== 1 ||
    !WORKFLOWS.some((x) => x.id === value.workflowId)
  )
    throw new Error("Choose a Chucksi workflow plan.");
  const spec = WORKFLOWS.find((x) => x.id === value.workflowId);
  if (
    typeof value.brief !== "string" ||
    value.brief.length > 4000 ||
    !Array.isArray(value.done) ||
    value.done.length !== spec.steps.length ||
    value.done.some((x) => typeof x !== "boolean")
  )
    throw new Error("This workflow plan has invalid fields.");
  return {
    version: 1,
    workflowId: value.workflowId,
    brief: value.brief,
    done: value.done,
    shotId: typeof value.shotId === "string" ? value.shotId.slice(0, 100) : "",
  };
}
export function stepURL(href, shotId, brief = "") {
  const u = new URL(href, "https://massless.invalid");
  if (
    shotId &&
    ["/video", "/music", "/3d", "/film", "/edit"].includes(u.pathname.replace(/\/$/, ""))
  )
    u.searchParams.set("shot", shotId);
  if (brief && u.pathname === "/film") u.searchParams.set("brief", brief.slice(0,600));
  return u.pathname + u.search;
}

// ---------- The Workflows gallery ----------
// Every card is a real, working entry point: it opens a Chucksi tool already set up with the same example the
// loop shows. Each loop and poster in /media/templates was recorded from that tool (see provenance.json there).
export const CATEGORIES = [
  { id: "effects", name: "Video effects" },
  { id: "moves", name: "Camera moves" },
  { id: "image", name: "Image edits" },
  { id: "design", name: "Design & print" },
  { id: "websites", name: "Websites" },
  { id: "games", name: "Games" },
  { id: "film", name: "Film & music" },
  { id: "office", name: "Office" },
];
const PORTRAIT = new Set(["samurai", "fisherman", "jellyfish", "summit"]);
const card = (id, cat, name, line, href, ar) => ({ id, cat, name, line, href, ar, video: `/media/templates/${id}.mp4`, poster: `/media/templates/${id}.webp` });
const EFFECT_CARDS = [
  ["lidar", "cyan", "canyon", "LiDAR scan", "A laser sweep turns your still into a point cloud"],
  ["lidar", "thermal", "summit", "Thermal scan", "A heat-map sweep across your photo"],
  ["lidar", "white", "lighthouse", "Point cloud", "Your scene rebuilt from white light points"],
  ["vanish", "embers", "dancer", "Embers", "The subject burns away into drifting sparks"],
  ["vanish", "ash", "samurai", "Turn to ash", "The subject crumbles and blows away"],
  ["vanish", "pixels", "diner", "Pixel dissolve", "The picture breaks into falling pixels"],
  ["freeze", "", "astronaut", "Bullet freeze", "Push in, freeze, swing around the subject"],
  ["clones", "rainbow", "neon", "Rainbow clones", "Colour echoes trail the subject"],
  ["clones", "natural", "bmx", "Clones", "Echoes trail the subject as the camera slides"],
  ["clones", "ghost", "jellyfish", "Ghost trail", "Glowing afterimages follow every move"],
].map(([effect, look, sample, name, line]) =>
  card(`fx-${effect}${look ? "-" + look : ""}`, "effects", name, line, `/video?effect=${effect}${look ? "&look=" + look : ""}&sample=${sample}`, PORTRAIT.has(sample) ? "3/4" : "16/9"));
// [move id, sample still, name, one line]
const MOVE_CARDS = [
  ["dolly-in", "rider", "Dolly in", "Push toward the subject"],
  ["arc-right", "fisherman", "Arc right", "Swing around the subject"],
  ["crane-up", "bmx", "Crane up", "Rise and look down"],
  ["handheld", "samurai", "Handheld", "Operator on their feet"],
  ["crash-zoom", "train", "Crash zoom", "A violent snap in on the subject"],
  ["truck-left", "astronaut", "Truck left", "Slide sideways, layers separate"],
  ["dolly-zoom", "lighthouse", "Dolly zoom", "The subject holds, the world looms in"],
  ["tilt-up", "diner", "Tilt up", "The camera stays, the view climbs"],
  ["fpv", "cinema", "FPV dive", "A drone rush with a banking turn"],
  ["breathe", "dancer", "Breathe", "Locked off, the frame just lives"],
  ["wide-orbit", "jellyfish", "Wide orbit", "A long swing around the subject"],
  ["pan-right", "canyon", "Pan right", "Turn the tripod head"],
  ["bullet-time", "neon", "Bullet time", "The moment freezes, the camera does not"],
  ["rack-focus", "summit", "Rack focus", "Pull focus from near to far"],
  ["dolly-out", "rider", "Dolly out", "Pull back to reveal"],
  ["arc-left", "fisherman", "Arc left", "Swing the other way"],
  ["crane-down", "bmx", "Crane down", "Descend into the scene"],
  ["snorricam", "samurai", "Snorricam", "Rig locked on, the world sways"],
  ["zoom-in", "train", "Zoom in", "The lens zooms, the camera stays put"],
  ["truck-right", "astronaut", "Truck right", "Slide the other way"],
  ["float", "lighthouse", "Float", "A slow drifting loop"],
  ["dutch-roll", "diner", "Dutch roll", "The horizon tips as tension rises"],
  ["crash-zoom-out", "cinema", "Crash zoom out", "Snap back from a tight detail"],
  ["tilt-down", "dancer", "Tilt down", "The camera stays, the view drops"],
  ["earthquake", "jellyfish", "Earthquake", "A hard jolt that settles"],
  ["pan-left", "canyon", "Pan left", "Turn the tripod head the other way"],
  ["zoom-out", "neon", "Zoom out", "The lens widens, the camera stays put"],
  ["dolly-zoom-in", "summit", "Vertigo", "The subject holds, the world falls away"],
].map(([move, sample, name, line]) => card(`move-${move}`, "moves", name, line, `/video?move=${move}&sample=${sample}`, PORTRAIT.has(sample) ? "3/4" : "16/9"));
const SHOWCASE_CARDS = [
  ["map", "map-saltmere", "Island map", "Name a place, get an illustrated map poster", "4/5"],
  ["map", "map-larkspur", "Valley map", "A painted map with labels, legend and compass", "4/5"],
  ["map", "map-saltmere-night", "Night map", "The same island after dark", "4/5"],
  ["identity", "id-pebble", "Bakery brand", "A name and a vibe become a full identity kit", "4/5"],
  ["identity", "id-northwind", "Bold brand", "Wordmark, palette, type and six applications", "4/5"],
  ["identity", "id-halcyon", "Calm brand", "A soft identity for a swim club", "4/5"],
  ["identity", "id-maison", "Luxe brand", "A quiet identity for a perfume atelier", "4/5"],
  ["identity", "id-lumen", "Tech brand", "A crisp identity for a research lab", "4/5"],
  ["film-poem", "film-tide", "Film poem", "A few lines become a short film", "4/5"],
  ["film-poem", "film-tide-cinema", "Cinema poem", "Your words, typed on over moving frames", "16/9"],
  ["poetry", "poe-small-maps", "Poetry posters", "A poem set as an editorial poster series", "4/5"],
  ["poetry", "poe-weather", "Weather report", "Big verse, tiny captions, a strict grid", "4/5"],
  ["poetry", "poe-slow-day", "Slow day", "House rules set as posters", "4/5"],
  ["festival", "fest-harbourlight", "Festival posters", "Lineup and dates become a poster series", "4/5"],
  ["festival", "fest-copper-lantern", "Jazz nights", "Two-colour posters, plus feed and story sizes", "4/5"],
  ["festival", "fest-mustard", "Mustard edition", "The same series in a new palette", "4/5"],
].map(([make, example, name, line, ar]) => card(`design-${example}`, "design", name, line, `${makeURL(make)}&example=${example}`, ar));
const SITE_CARDS = [
  ["wellness-studio", "Stillform · Wellness", "A warm studio with a welcoming first-visit flow"],
  ["music-artist", "After Hours · Music", "An artist story, live dates and booking enquiries"],
  ["property-story", "Lake & Light · Property", "An architectural story with a path to a viewing"],
  ["editorial-shop", "Editorial shop", "A shop that reads like a magazine"],
  ["manifesto", "Manifesto", "Big statements over a moving line field"],
  ["portfolio-timeline", "Portfolio timeline", "Case studies in order, scrolling sideways"],
  ["ai-product", "AI product launch", "A portrait-led launch page"],
  ["local-business", "Local business", "Services, reviews and a quote form"],
  ["photographer", "Photographer", "A calm portfolio with a masonry gallery"],
  ["app-landing", "App landing", "Features, steps, pricing and FAQ"],
  ["conference", "Conference", "Speakers, tickets, schedule and venue"],
  ["restaurant", "Restaurant", "Menu, photos, hours and table requests"],
  ["book-launch", "Book launch", "Chapters, the author and a free sample"],
  ["app-waitlist", "App waitlist", "A night-sky page with an early-access form"],
].map(([id, name, line]) => card(`site-${id}`, "websites", name, line, `/website?template=${id}`, ["wellness-studio", "music-artist", "property-story"].includes(id) ? "16/9" : "3/4"));
const GAME_CARDS = [
  ["t1-street-run", "Street run", "Hop the cones, stomp the rivals"],
  ["sky-tower", "Sky tower", "Stack a skyscraper floor by floor"],
  ["star-hornets", "Star hornets", "Fly, dodge and fire on your own"],
  ["tp-robot-match", "Robot match", "Swap tiles, match three"],
  ["deep-snack", "Deep snack", "Eat smaller fish, dodge bigger ones"],
  ["cheese-quest", "Cheese quest", "Grab every key, find the door"],
  ["dune-rover", "Dune rover", "Jump the dunes in a desert run"],
  ["pancake-panic", "Pancake panic", "Drop the stack, line it up"],
  ["jelly-storm", "Jelly storm", "A shooter in deep water"],
  ["crystal-caves", "Crystal caves", "A maze of gems and keys"],
  ["planet-muncher", "Planet muncher", "Eat and grow through space"],
  ["night-circuit", "Night circuit", "A neon match-three"],
].map(([id, name, line]) => card(`game-${id}`, "games", name, line, `/games#play=${id}`, "3/4"));
const OPTICAL_CARDS = OPTICAL_EFFECTS.flatMap((effect) => effect.looks.slice(0, 1).map((look) =>
  card(`fx-${effect.id}-${look.id}`, "effects", effect.name, effect.hint,
    `/video?effect=${effect.id}&look=${look.id}&sample=${effect.sample}`,
    PORTRAIT.has(effect.sample) ? "9/16" : "16/9")));

export const GALLERY = [
  ...OPTICAL_CARDS,
  ...EFFECT_CARDS,
  ...MOVE_CARDS,
  card("image-compose", "image", "Reframe & grade", "Recompose a photo on a new backdrop", "/edit/", "16/9"),
  card("image-remove-bg", "image", "Remove background", "Cut out any subject", "/edit/?tool=remove-bg", "16/9"),
  card("image-upscale", "image", "Upscale", "Sharper, bigger images without the blur", "/edit/?tool=upscale", "16/9"),
  card("image-erase", "image", "Erase objects", "Brush out what does not belong", "/edit/?tool=erase", "16/9"),
  card("image-depth", "image", "Photo to 3D", "Turn a still into a scene you can orbit", "/3d?sample=samurai", "16/9"),
  card("image-scene", "image", "3D scene", "Stage objects and lights, export GLB", "/scene/", "16/9"),
  ...SHOWCASE_CARDS,
  ...SITE_CARDS,
  ...GAME_CARDS,
  card("film-launch", "film", "Launch film", "A brief becomes a scored, beat-cut film", "/film", "16/9"),
  card("film-music", "film", "Music visualizer", "Artwork and your track, cut to the beat", "/music", "16/9"),
  card("film-captions", "film", "Captions", "Edit by text and burn in styled captions", "/cut/", "16/9"),
  card("film-voice", "film", "Voiceover", "Turn a script into a voice", "/audio?tab=voice", "16/9"),
  card("film-beds", "film", "Sound beds", "Rain, wind and city ambience", "/audio?tab=beds", "16/9"),
  card("office-annotate", "office", "Annotate a PDF", "Highlight, write, draw and sign", "/office?sample=1", "16/9"),
  card("office-sign", "office", "Send for signature", "Contract templates, signers and an audit trail", "/office?tab=sign", "16/9"),
  card("office-templates", "office", "Contract templates", "Pick a contract, fill it in, send it", "/office?tab=sign", "16/9"),
];
// The loops in the moving strip at the top of the page.
export const FEATURED = ["fx-hologram-ion", "fx-shatter-spectrum", "fx-shockwave-water", "fx-portal-cosmic", "fx-lidar-cyan", "site-manifesto", "move-arc-right", "design-fest-harbourlight", "fx-vanish-embers", "game-sky-tower", "move-fpv", "design-id-northwind", "fx-clones-rainbow", "site-restaurant", "film-launch", "move-bullet-time", "design-film-tide", "game-star-hornets"];
