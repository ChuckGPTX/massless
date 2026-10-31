export const WORKFLOWS = [
  {id:'image-workroom',name:'Image to campaign frame',tag:'IMAGE + DESIGN',image:'/media/website/ceramics.jpg',description:'Reframe an image, adjust its finish and add a headline. Save a new take, ready for motion.',output:'PNG + saved take',steps:[['Choose or create an image','/image'],['Compose a new take','/edit/'],['Use the saved take in your next tool','/library/']]},
  {id:'scene-stage',name:'Objects to a 3D scene',tag:'3D + IMAGE',image:'/media/art/observatory.jpg',description:'Stage real objects and lights, orbit the camera, and export a complete editable scene.',output:'GLB + PNG frame',steps:[['Stage your objects','/scene/'],['Set lighting and camera','/scene/'],['Export GLB or save a frame','/scene/']]},
  {id:'website-template',name:'A studio website of your own',tag:'IMAGE + WEBSITE',image:'/media/website/pavilion.jpg',description:'Use your imagery in an original responsive studio website. Edit the copy and export a standalone page.',output:'Offline HTML website',steps:[['Create your featured image','/image'],['Choose images and edit your website','/build/?template=website'],['Preview and export HTML','/build/?template=website']]},
  {id:'arcade-template',name:'Customize a playable arcade',tag:'GAME + DESIGN',image:'/media/art/astronaut.jpg',description:'Change the title, color and difficulty of an original arcade game, then export it to share.',output:'Offline HTML game',steps:[['Set up the game','/build/?template=game'],['Play and tune difficulty','/build/?template=game'],['Export your game','/build/?template=game']]},
  {
    id: "release-teaser",
    name: "Artwork to release teaser",
    tag: "IMAGE + AUDIO + VIDEO",
    image: "/media/music/showtime-preview.jpg",
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
export function validatePlan(value) {
  if (
    !value ||
    value.version !== 1 ||
    !WORKFLOWS.some((x) => x.id === value.workflowId)
  )
    throw new Error("Choose a Massless workflow plan.");
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
