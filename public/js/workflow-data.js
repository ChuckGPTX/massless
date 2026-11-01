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
      ["Animate your saved image", "/video?move=orbit-right"],
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
  { id: "map", name: "Illustrated map", tag: "IMAGE + MAP", image: "/media/make/thumb-map.webp", description: "Name a place. FLUX paints it from straight above; you get a map poster with editable labels, legend and compass.", output: "Poster PNG + print PDF", frames: 1 },
  { id: "identity", name: "Brand identity kit", tag: "BRAND + SYSTEM", image: "/media/make/thumb-identity.webp", description: "A name and a vibe become a studio-style identity: wordmark, monogram, OKLCH palette, type, pattern and six applications.", output: "Board + 7 PNGs + SVG + tokens JSON", frames: 0 },
  { id: "film-poem", name: "Film poem", tag: "TEXT + IMAGE + FILM", image: "/media/make/thumb-film-poem.webp", description: "Write a few lines. Each one gets a FLUX frame, typed-on words and a slow camera move, cut into a 20 to 40 second film.", output: "MP4 / WebM + title card", frames: 4 },
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
