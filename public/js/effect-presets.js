// Shared original effect recipes, used by the renderer and preset gallery.
export const OPTICAL_EFFECTS = [
  { id: 'hologram', name: 'Hologram', hint: 'Scan your scene into a luminous projection', duration: 5,
    sample: 'samurai', needsMatte: false, posterTime: 0.46,
    looks: [{ id: 'ion', name: 'Ion blue' }, { id: 'violet', name: 'Ultraviolet' }, { id: 'amber', name: 'Amber signal' }] },
  { id: 'shatter', name: 'Prism shatter', hint: 'Fractured glass splits the image, then falls back into place', duration: 5,
    sample: 'neon', needsMatte: false, posterTime: 0.48,
    looks: [{ id: 'spectrum', name: 'Spectrum' }, { id: 'ice', name: 'Ice glass' }, { id: 'gold', name: 'Gold facets' }] },
  { id: 'shockwave', name: 'Shockwave', hint: 'A pulse bends light as it races through the scene', duration: 4,
    sample: 'astronaut', needsMatte: false, posterTime: 0.38,
    looks: [{ id: 'water', name: 'Liquid pulse' }, { id: 'sonic', name: 'Sonic blue' }, { id: 'magma', name: 'Heatwave' }] },
  { id: 'portal', name: 'Portal pull', hint: 'Twist your scene through a glowing vortex and back', duration: 6,
    sample: 'lighthouse', needsMatte: false, posterTime: 0.44,
    looks: [{ id: 'cosmic', name: 'Cosmic' }, { id: 'solar', name: 'Solar flare' }, { id: 'frost', name: 'Frozen light' }] },
  { id: 'melt', name: 'Liquid melt', hint: 'The image flows downward in glossy liquid ribbons', duration: 5, sample: 'diner', needsMatte: false, posterTime: 0.5, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'inflate', name: 'Bubble lens', hint: 'A glass bubble swells from the centre of your photo', duration: 5, sample: 'jellyfish', needsMatte: false, posterTime: 0.48, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'squish', name: 'Elastic bounce', hint: 'Compress the frame, then spring back with a soft wobble', duration: 4, sample: 'bmx', needsMatte: false, posterTime: 0.43, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'chromatic', name: 'Prism zoom', hint: 'Push through layered red, green and blue light trails', duration: 4, sample: 'train', needsMatte: false, posterTime: 0.5, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'glitch', name: 'Signal break', hint: 'Digital slices slip out of sync and snap back', duration: 4, sample: 'rider', needsMatte: false, posterTime: 0.5, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'pixel-sort', name: 'Pixel cascade', hint: 'Bright details stretch into streams of falling colour', duration: 5, sample: 'neon', needsMatte: false, posterTime: 0.48, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'ink', name: 'Ink reveal', hint: 'An ink wash spreads across paper and reveals your image', duration: 6, sample: 'fisherman', needsMatte: false, posterTime: 0.44, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'neon', name: 'Neon sketch', hint: 'Trace the scene in electric lines before returning to colour', duration: 5, sample: 'cinema', needsMatte: false, posterTime: 0.5, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'kaleido', name: 'Mirror bloom', hint: 'Fold the image into a turning kaleidoscope', duration: 6, sample: 'summit', needsMatte: false, posterTime: 0.5, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'slit', name: 'Ribbon drift', hint: 'Bands of your image drift into a flowing time-slice illusion', duration: 5, sample: 'dancer', needsMatte: false, posterTime: 0.48, looks: [{ id: 'signature', name: 'Signature' }] },
  { id: 'fold', name: 'Paper fan', hint: 'The frame opens into an accordion of shaded paper folds', duration: 5, sample: 'canyon', needsMatte: false, posterTime: 0.48, looks: [{ id: 'signature', name: 'Signature' }] },
].map((effect) => ({
  ...effect,
  previewVideo: `/media/templates/fx-${effect.id}-${effect.looks[0].id}.mp4`,
  previewPoster: `/media/templates/fx-${effect.id}-${effect.looks[0].id}.webp`,
}));

export const opticalEffectById = (id) => OPTICAL_EFFECTS.find((effect) => effect.id === id) || null;

