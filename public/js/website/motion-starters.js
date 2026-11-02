// Original campaign starters inspired by interaction patterns, with no borrowed page code.
import { templateSite, newSection, sanitizeSite } from './spec.js';

const image = (src, alt) => ({ src, alt, prompt: '' });
const link = (label, href) => ({ label, href });
const pictures = {
  aural: image('/media/website/aural-object/hero.webp', 'An original silver and ivory headphone concept in a soft studio light'),
  current: image('/media/website/current-studio/hero.webp', 'Cobalt and silver sculpture twisting through a terracotta space'),
  nightjar: image('/media/website/nightjar-film/hero.webp', 'An astronaut on a volcanic shore beneath an orange moon'),
  shore: image('/media/website/manifesto/dusk-water.webp', 'A quiet shoreline in the last light of the day'),
  city: image('/media/website/manifesto/fog-avenue.webp', 'A city avenue disappearing into atmospheric fog'),
  stage: image('/media/website/music-artist/hero.webp', 'A soul singer performing under indigo and amber lights'),
  home: image('/media/website/property-story/hero.webp', 'A cedar and limestone home beside a still lake'),
  ritual: image('/media/website/wellness-studio/detail.webp', 'Linen and clay yoga mats arranged on a pale oak bench'),
};

export function buildMotionStarter(id) {
  const configs = {
    'aural-object': { name: 'Aural', kind: 'product', style: 'ai-product', tagline: 'An object for the way you listen.' },
    'current-studio': { name: 'Current', kind: 'cases', style: 'bold', tagline: 'Independent design. Shared energy.' },
    'nightjar-film': { name: 'Nightjar', kind: 'portfolio', style: 'swiss', tagline: 'Pictures with something to say.' },
  };
  const config = configs[id];
  if (!config) return null;
  const site = templateSite({ prompt: `A website for ${config.name}`, kind: config.kind, style: config.style });
  site.name = config.name; site.tagline = config.tagline;
  site.contact = { email: '', phone: '', address: '', form: '' };
  site.collections = { posts: [], listings: [], tracks: [], menu: [] };
  site.theme.motion = 'lively';
  site.seo = { ...site.seo, title: `${config.name} — ${config.tagline}`, description: config.tagline, url: '' };
  const section = (type, variant, data, tone = 'base') => ({ ...newSection(type, site), ...data, variant, tone });
  const footer = section('footer', 'columns', { tagline: config.tagline, social: [] });
  const contact = (title, text) => section('contact', 'split', { anchor: 'contact', eyebrow: 'Start a conversation', title, text, hours: '', button: 'Open email to send' }, 'alt');
  const statement = (text, note = '') => section('statement', 'reveal', { eyebrow: '', text, note });
  let sections;

  if (id === 'aural-object') {
    site.theme.palette = 'linen'; site.theme.accent = '#345b56'; site.theme.radius = 24; site.theme.spacing = 'airy';
    site.nav.cta = link('Meet Aural', '#design');
    sections = [
      section('hero', 'object', { eyebrow: 'Aural / Listening objects', title: 'Less noise.\nMore *feeling.*', subtitle: 'A quieter kind of presence. A listening object shaped around the moments you want to keep.', image: pictures.aural, cta: link('Explore the design', '#design'), cta2: link('Start a conversation', '#contact'), note: 'An original listening concept.' }),
      section('features', 'icons', { anchor: 'design', eyebrow: 'Considered from every angle', title: 'Small details.\nA different *feeling.*', subtitle: 'A design story built around everyday rituals.', items: [
        { icon: 'heart', title: 'Softer shapes', text: 'Quiet curves and tactile materials invite a closer look.' },
        { icon: 'sun', title: 'Room to slow down', text: 'An object that belongs in the moments between the busy ones.' },
        { icon: 'sparkle', title: 'Nothing extra', text: 'A restrained palette. A clear purpose. Details that earn their place.' },
      ] }),
      statement('The best things in your day do not ask for your attention. They make room for *it.*'),
      section('about', 'split', { anchor: 'approach', eyebrow: 'The listening ritual', title: 'A moment that\nbelongs to *you.*', text: 'A window open. A favorite record. The long way home.\n\nAural is an exploration of the objects we keep close and the quiet rituals that make everyday life feel more considered.', points: [], image: pictures.ritual, cta: link('Tell us what you think', '#contact') }, 'alt'),
      section('faq', 'columns', { title: 'A few things\nto *know.*', subtitle: '', items: [
        { q: 'What is Aural?', a: 'A fictional product concept showing how a thoughtful launch page can feel. Replace the concept with your own product, photography and verified details.' },
        { q: 'Can visitors order here?', a: 'This concept starts with a conversation. Add your real checkout link when your product is ready to sell.' },
      ] }),
      contact('Good things begin\nwith *listening.*', 'Ask about the concept, share an idea or start a collaboration.'), footer,
    ];
  } else if (id === 'current-studio') {
    site.theme.palette = 'gallery'; site.theme.accent = '#2347d8'; site.theme.radius = 4; site.theme.spacing = 'airy';
    site.nav.cta = link('Start something', '#contact');
    const projects = [
      { year: '2026', title: 'Form in motion', role: 'Art direction', client: 'Studio study', text: 'Color, material and a shape that refuses to stand still.', image: pictures.current, credits: 'Concept / Current', link: link('Discuss a project', '#contact') },
      { year: '2025', title: 'A quieter object', role: 'Product story', client: 'Aural concept', text: 'An everyday ritual, expressed through restraint and material detail.', image: pictures.aural, credits: 'Concept / Current', link: link('Discuss a project', '#contact') },
      { year: '2024', title: 'Room for light', role: 'Digital experience', client: 'Architecture study', text: 'A slower scroll through a place you can almost feel.', image: pictures.home, credits: 'Concept / Current', link: link('Discuss a project', '#contact') },
    ];
    sections = [
      section('hero', 'editorial', { eyebrow: 'Current / An independent design practice', title: 'Good ideas.\n*Great energy.*', subtitle: 'We turn a clear point of view into brands, digital experiences and images with a pulse.', cta: link('See the work', '#work'), cta2: link('Start something', '#contact'), note: 'A small studio. A wide-open imagination.', image: pictures.current }),
      section('logos', 'marquee', { title: '', items: ['Identity', 'Digital', 'Art direction', 'Motion', 'A little unexpected'].map(name => ({ name })) }, 'acc'),
      section('cases', 'rail', { anchor: 'work', eyebrow: 'Selected explorations / 2024—2026', title: 'Ideas made *visible.*', items: projects }),
      statement('Make it clear. Make it feel something. Then make it a little *unexpected.*'),
      section('timeline', 'steps', { anchor: 'approach', eyebrow: 'From first question to final detail', title: 'A simple process.\nSpace for *possibility.*', subtitle: '', items: [
        { date: '01', title: 'Find the point', text: 'Start with the people, the purpose and the thing that makes you different.' },
        { date: '02', title: 'Explore the edges', text: 'Make tangible directions. Look at them together. Keep what feels right.' },
        { date: '03', title: 'Make it real', text: 'Build the system, refine the details and give the idea a place in the world.' },
      ] }, 'alt'),
      contact('Have a good *feeling?*', 'Tell us what you are working on, what needs to change and where you would like to go.'), footer,
    ];
  } else {
    site.theme.mode = 'dark'; site.theme.palette = 'void'; site.theme.accent = '#e9b769'; site.theme.radius = 12; site.theme.spacing = 'airy';
    site.nav.cta = link('Tell your story', '#contact');
    const films = [pictures.nightjar, pictures.city, pictures.stage, pictures.shore, pictures.home];
    sections = [
      section('hero', 'mosaic', { eyebrow: 'Nightjar / A moving-image practice', title: 'Stay for\nthe *story.*', subtitle: 'Strange places. Familiar feelings. Visual stories for people who look a little closer.', image: pictures.nightjar, images: films.slice(1).map(image => ({ image })), cta: link('Explore the collection', '#work'), cta2: link('Start a project', '#contact'), note: 'Independent ideas. A cinematic point of view.' }),
      section('gallery', 'masonry', { anchor: 'work', eyebrow: 'The collection', title: 'A world in\nevery *frame.*', subtitle: 'Original visual studies. The beginning of a story, waiting to be told.', items: films.map((image, i) => ({ image, caption: ['Low orbit / Speculative cinema', 'Before the city wakes / Atmosphere', 'After the last song / Music', 'The distance between / Landscape', 'The way home / Architecture'][i] })) }),
      statement('A good image makes you look. A good story makes you *stay.*'),
      section('about', 'centered', { anchor: 'approach', eyebrow: 'A way of seeing', title: 'Follow the *feeling.*', text: 'We begin with a mood, a question or a detail that will not leave us alone. Then we find its rhythm.\n\nFrom a first visual study to a finished campaign, the aim stays the same: make something worth spending time with.', image: pictures.shore, points: [], cta: link('Tell us your idea', '#contact') }, 'alt'),
      contact('What story\nis on your *mind?*', 'A film, a campaign, an experiment. Send a few words about what you want to make.'), footer,
    ];
  }
  site.pages = [{ ...site.pages[0], title: 'Home', slug: '', sections }];
  site.seo.image = sections[0].image;
  return sanitizeSite(site, site, { source: 'user' });
}
