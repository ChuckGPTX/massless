// Original complete starters. No third-party template code or remote runtime.
import { templateSite, newSection, sanitizeSite } from './spec.js';

const photo = (id, alt) => ({ src: `/media/website/${id}/hero.webp`, alt, prompt: alt });
const link = (label, href) => ({ label, href });

export function buildStarter(id) {
  const configs = {
    'wellness-studio': { name: 'Stillform', kind: 'business', style: 'studio', tagline: 'A little space to feel like yourself.', cta: 'Find your class' },
    'music-artist': { name: 'After Hours', kind: 'band', style: 'bold', tagline: 'For the nights you want to keep.', cta: 'Booking & press' },
    'property-story': { name: 'Lake & Light', kind: 'realestate', style: 'editorial', tagline: 'A home with room to exhale.', cta: 'Arrange a viewing' },
  };
  const c = configs[id];
  if (!c) return null;
  const site = templateSite({ prompt: `A website for ${c.name}`, kind: c.kind, style: c.style });
  site.name = c.name;
  site.tagline = c.tagline;
  site.contact = { email: '', phone: '', address: '', form: '' };
  site.collections = { posts: [], listings: [], tracks: [], menu: [] };
  site.nav.cta = link(c.cta, '#contact');
  site.seo = { ...site.seo, title: `${c.name} — ${c.tagline}`, description: c.tagline, url: '' };
  const s = (type, data, variant, tone = 'base') => Object.assign(newSection(type, site), data, { ...(variant ? { variant } : {}), tone });
  const contact = (title, text) => s('contact', { title, text, hours: '', eyebrow: 'Make a connection', button: 'Open email to send' }, 'split', 'alt');
  const footer = s('footer', { tagline: c.tagline, social: [] }, 'columns');
  let sections;

  if (id === 'wellness-studio') {
    site.theme.accent = '#70513b'; site.theme.radius = 4;
    const image = photo(id, 'Sunlight falling across clay yoga mats in a warm, arched movement studio');
    sections = [
      s('hero', { eyebrow: 'Movement. Breath. A fresh start.', title: 'Make room for *yourself.*', subtitle: 'A welcoming space for intentional movement, unhurried practice and time that belongs to you.', cta: link('Explore the classes', '#services'), cta2: link('Plan your first visit', '#contact'), note: 'Move at your own pace.', image }, 'split'),
      s('features', { eyebrow: 'Find your rhythm', title: 'A practice for *your day.*', subtitle: 'Choose the kind of movement you need. Your teacher helps you make it your own.', items: [
        { icon: 'sun', title: 'Morning flow', text: 'Ease into the day with breath-led movement and a little room to stretch.' },
        { icon: 'heart', title: 'Build your strength', text: 'Steady, considered movement with options for different levels of experience.' },
        { icon: 'lotus', title: 'Slow things down', text: 'A quieter practice with longer holds, gentle movement and a restful finish.' },
      ] }, 'icons'),
      s('statement', { eyebrow: 'Our approach', text: 'You do not need to be good at it.\nYou just need a place to *begin.*', note: 'A little more presence. A little less pressure.' }, 'center', 'alt'),
      s('about', { eyebrow: 'Room to breathe', title: 'Small rituals. *More room.*', text: 'A quiet corner, a little daylight and a moment before the day gets busy. Make arriving part of your practice.', points: [], cta: link('Plan a visit', '#contact'), image: { src: '/media/website/wellness-studio/detail.webp', alt: 'Clay yoga mats and linen on an oak bench in a sunlit studio', prompt: '' } }, 'split'),
      s('timeline', { eyebrow: 'Your first visit', title: 'From curious to *comfortable.*', items: [
        { date: '01', title: 'Choose your practice', text: 'Tell us what you enjoy and how you would like to feel.' },
        { date: '02', title: 'Ask us anything', text: 'Check the schedule, what to bring and which class suits you.' },
        { date: '03', title: 'Make some space', text: 'Arrive a little early, settle in and meet your teacher.' },
      ] }, 'steps'),
      s('faq', { title: 'Before you *arrive.*', items: [{ q: 'Is this a space for beginners?', a: 'Yes. Tell your teacher it is your first visit so they can help you find the right options.' }, { q: 'How do I book a class?', a: 'Use the contact section below to ask about current classes and availability.' }, { q: 'What should I bring?', a: 'Wear something comfortable to move in and bring water. Ask us about mats and any other equipment before your first class.' }] }, 'accordion'),
      contact('Let’s find your *first class.*', 'Tell us a little about yourself and when you would like to visit. We will help you find a good place to begin.'), footer,
    ];
  } else if (id === 'music-artist') {
    site.theme.mode = 'dark'; site.theme.accent = '#d7ed7b'; site.theme.radius = 2;
    const image = photo(id, 'An original soul band performing under blue and amber stage lights');
    sections = [
      s('hero', { eyebrow: 'Independent sound. Shared nights.', title: 'Stay for\nthe *feeling.*', subtitle: 'Songs for the long way home. A new chapter from After Hours.', cta: link('Meet the music', '#about'), cta2: link('Booking & press', '#contact'), note: 'Turn it up. Take your time.', image }, 'cover'),
      s('logos', { title: '', items: ['New sounds', 'Live rooms', 'Late nights', 'Independent always'].map(name => ({ name })) }, 'marquee', 'acc'),
      s('about', { eyebrow: 'The next chapter', title: 'A little soul.\nA lot of *feeling.*', text: 'After Hours lives where the last song meets the first light. Built around a voice, a rhythm and the feeling of being in the same room.\n\nThis is a space for the records, the stories behind them and the nights that bring them to life.', points: [], cta: link('Get in touch', '#contact'), image: { src: '/media/website/music-artist/detail.webp', alt: 'Bass guitar and microphone in an indigo and amber rehearsal room', prompt: '' } }, 'split'),
      s('statement', { eyebrow: 'The live experience', text: 'Some songs sound different when we are *all in the room.*', note: 'Live, together. That is the whole idea.' }, 'left', 'alt'),
      s('schedule', { eyebrow: 'On stage', title: 'The next *night out.*', subtitle: 'Small rooms. A shared rhythm. Be part of the next one.', items: [{ day: 'Dates to come', time: 'Next chapter', title: 'See you in the room', text: 'New shows are on the way. Contact us for bookings and announcements.', link: link('Ask about shows', '#contact') }] }, 'list'),
      contact('Bring the sound\nto *your room.*', 'For live bookings, collaborations and press, send a few details about what you have in mind.'), footer,
    ];
  } else {
    site.theme.accent = '#745c42'; site.theme.radius = 2;
    const image = photo(id, 'An imagined cedar and limestone lakeside house at sunset');
    sections = [
      s('hero', { eyebrow: 'Lake & Light / A property story', title: 'The view is only\nthe *beginning.*', subtitle: 'Open spaces. Natural materials. A slower kind of arrival.', cta: link('Explore the home', '#services'), cta2: link('Arrange a viewing', '#contact'), note: 'Illustrative property concept · replace with your listing.', image }, 'cover'),
      s('features', { eyebrow: 'Designed around living', title: 'Room for the way\nyou *want to live.*', subtitle: 'Use this space to tell the story behind your listing.', items: [
        { icon: 'sun', title: 'Light, throughout', text: 'Describe the orientation, the windows and how the rooms feel throughout the day.' },
        { icon: 'home', title: 'Space that connects', text: 'Explain how the living spaces, kitchen and outdoor areas fit together.' },
        { icon: 'leaf', title: 'A place of its own', text: 'Share the setting, nearby places and details that make this location distinctive.' },
      ] }, 'icons'),
      s('about', { eyebrow: 'The art of staying in', title: 'Life opens *outwards.*', text: 'Warm timber, quiet textures and room to watch the light change. An imagined living space that puts the view at the heart of the home.', points: [], cta: link('Arrange a viewing', '#contact'), image: { src: '/media/website/property-story/detail.webp', alt: 'Illustrative lakeside living room with limestone fireplace and sunset views', prompt: '' } }, 'split'),
      s('stats', { title: 'The home, *at a glance.*', items: [{ value: '3', label: 'Bedrooms · example', ph: true }, { value: '2', label: 'Bathrooms · example', ph: true }, { value: '2,100 ft²', label: 'Interior · example', ph: true }, { value: 'Enquire', label: 'Price on request', ph: true }] }, 'row', 'alt'),
      s('statement', { text: 'A good home does more than look beautiful. It makes everyday life feel *different.*', note: 'Tell the story. Let your own photographs do the rest.' }, 'center'),
      s('faq', { title: 'Before your *visit.*', items: [{ q: 'Where is the property?', a: 'This is an illustrative property concept. Replace these images and details with your verified listing before publishing.' }, { q: 'How do I arrange a viewing?', a: 'Contact the listing representative below with a few preferred dates.' }, { q: 'Where can I find the full details?', a: 'Contact the listing representative for the brochure, disclosures and floor plans.' }] }, 'accordion'),
      contact('Picture yourself *here.*', 'Ask for the property details or arrange a time to see the home.'), footer,
    ];
  }
  site.pages = [{ ...site.pages[0], title: 'Home', slug: '', sections }];
  return sanitizeSite(site, site, { source: 'user' });
}
