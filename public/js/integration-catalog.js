// The integration directory describes real studio features. A studio link is a
// handoff for a person, not a claim that an API has rendered or saved a result.
import { GALLERY, WORKFLOWS, DESIGN_WORKFLOWS, CAMERA_MOVES, PRESET_CARDS } from './workflow-data.js';
import { presetById } from './presets/catalog.js';

export const STUDIO_BASE = 'https://chucksi.com';
const absolute = path => new URL(path, STUDIO_BASE).href;
export const CHUCKSI_TOOLS = [
  ['image', 'Image studio', 'Design and generate a still with camera, lighting and composition controls.', '/image', ['prompt'], ['image']],
  ['image-edit', 'Image workroom', 'Reframe, remove backgrounds, erase objects and upscale images.', '/edit/', ['image'], ['image']],
  ['video', 'Video studio', 'Animate a still with camera moves and effects including LiDAR and Vanish.', '/video', ['image', 'preset'], ['video']],
  ['audio', 'Audio studio', 'Create voiceovers, transcribe recordings, extract audio and master a mix.', '/audio', ['text', 'audio', 'video'], ['audio', 'captions']],
  ['music', 'Music visualizer', 'Combine your artwork and track in a beat-synced teaser.', '/music', ['image', 'audio'], ['video']],
  ['film', 'Launch film', 'Arrange title-led scenes into a short scored film.', '/film', ['brief', 'images'], ['video']],
  ['3d', '3D studio', 'Explore an image as a depth scene and export a point cloud.', '/3d', ['image'], ['ply']],
  ['scene', 'Scene builder', 'Stage objects and lights, then export an editable 3D scene.', '/scene/', ['objects'], ['glb', 'image']],
  ['office', 'Office studio', 'Annotate and organize PDFs, convert documents and prepare signatures.', '/office', ['documents'], ['pdf']],
  ['website', 'Website builder', 'Browse website templates, personalize a site and export it. Sign in to publish.', '/website/', ['brief', 'content'], ['website']],
  ['games', 'Game builder', 'Describe or remix a playable game and export a standalone HTML file.', '/games/', ['brief'], ['html-game']],
].map(([id, name, description, path, inputs, outputs]) => ({
  id, name, description, inputs, outputs, studioUrl: absolute(path),
  execution: 'studio', remoteExecution: false,
}));

// Reuse the exact recipes shown by the studio, so links, names and looks stay in sync.
const VIDEO_EFFECTS = GALLERY.filter(item => item.cat === 'effects' && item.href.startsWith('/video?effect='));
export const CHUCKSI_PRESETS = [...PRESET_CARDS, ...VIDEO_EFFECTS, ...CAMERA_MOVES].map(item => {
  const url = new URL(item.href, STUDIO_BASE);
  const spec = item.id.startsWith('preset-') ? presetById(item.id.slice(7)) : null;
  return {
    id: item.id, name: item.name, category: item.cat, description: item.line,
    studioUrl: url.href, settings: Object.fromEntries(url.searchParams),
    preview: { image: absolute(item.poster), video: absolute(item.video) },
    inputs: spec ? [...new Set(spec.inputs.filter(i => !i.optional).map(i => (i.type === 'image' ? 'image' : i.type === 'textarea' || i.type === 'text' ? 'text' : 'option')))] : ['image'],
    execution: 'studio', remoteExecution: false,
  };
});

export const CHUCKSI_WORKFLOWS = [...WORKFLOWS, ...DESIGN_WORKFLOWS].map(item => ({
  id: item.id, name: item.name, description: item.description, category: item.tag,
  output: item.output, execution: 'studio', remoteExecution: false,
  steps: (item.steps || [['Open and customize the workflow', item.href]]).map(([name, path]) => ({ name, studioUrl: absolute(path) })),
}));

export const INTEGRATION_CAPABILITIES = {
  version: '2026-11-02',
  mcp: 'https://console.chucksi.com/mcp',
  openapi: 'https://console.chucksi.com/api/v1/openapi.json',
  authentication: 'No account or key required for public discovery.',
  available: ['Discover studio tools', 'Find effect and camera presets', 'Retrieve preset settings and studio links', 'Read workflow steps'],
  remoteActions: { generateMedia: false, uploadFiles: false, readPrivateProjects: false, publishWebsites: false },
  handoff: 'Use the returned studioUrl to continue in Chucksi. These public endpoints do not execute a render, save a project or publish.',
  websiteStudio: 'https://chucksi.com/website/',
  docs: 'https://console.chucksi.com/docs/',
};
