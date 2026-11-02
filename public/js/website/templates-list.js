// One-click website templates: a small data list with no imports, so any page can link to them
// (for example the Workflows page). Each opens the builder with that template's example site loaded:
// /website?template=<id>. Thumbnails are screenshots of the templates themselves (tests/website_thumbs.py).

export const TEMPLATES_LIST = [
  { id: 'wellness-studio', title: 'Stillform · Wellness', description: 'A sunlit studio, class introductions and a gentle path to a first visit.', style: 'studio', kind: 'business', isNew: true },
  { id: 'music-artist', title: 'After Hours · Music', description: 'A cinematic live stage, artist story, show dates and booking enquiries.', style: 'bold', kind: 'band', isNew: true },
  { id: 'property-story', title: 'Lake & Light · Property', description: 'A full-screen architectural story, property facts and viewing enquiries.', style: 'editorial', kind: 'realestate', isNew: true },
  { id: 'editorial-shop', title: 'Editorial shop', description: 'A clothing label shop: tiny chrome, wide caps, a full-bleed lookbook and a product grid.', style: 'editorial-shop', kind: 'shop', isNew: true },
  { id: 'manifesto', title: 'Manifesto', description: 'A long scroll of big statements over a moving line field, with line art that draws itself in.', style: 'manifesto', kind: 'manifesto', isNew: true },
  { id: 'portfolio-timeline', title: 'Portfolio timeline', description: 'Case studies in order on white, scrolling sideways while the year counts down.', style: 'portfolio-timeline', kind: 'cases', isNew: true },
  { id: 'ai-product', title: 'AI product launch', description: 'A portrait-led launch page with labels that lock in as you scroll, then proof on a dark band.', style: 'ai-product', kind: 'product', isNew: true },
  { id: 'local-business', title: 'Local business', description: 'Services, how it works, reviews and a quote form for a business that serves a town.', style: 'friendly', kind: 'business' },
  { id: 'photographer', title: 'Photographer', description: 'A calm portfolio with a masonry gallery, a journal and a booking form.', style: 'studio', kind: 'portfolio' },
  { id: 'app-landing', title: 'App landing page', description: 'A crisp product page with a bento of features, steps, pricing and FAQ.', style: 'swiss', kind: 'landing' },
  { id: 'conference', title: 'Conference', description: 'A loud one-day event with speakers, tickets, a schedule and the venue.', style: 'bold', kind: 'event' },
  { id: 'restaurant', title: 'Restaurant', description: 'A dark, candle-lit site with the menu, photos, hours and table requests.', style: 'luxe', kind: 'restaurant' },
  { id: 'book-launch', title: 'Book launch', description: 'A warm launch page with chapters, the author, editions and a free sample.', style: 'editorial', kind: 'launch' },
  { id: 'app-waitlist', title: 'App waitlist', description: 'A night-sky waitlist page with glass cards and an early-access form.', style: 'aurora', kind: 'waitlist' },
].map((t) => ({ ...t, thumb: `/media/website/tpl-${t.id}.webp`, href: `/website?template=${t.id}` }));
