// Starter templates: seven finished example decks (fictional companies and people) built from the same slide
// layouts the writer uses. Photos are the site's own generated stock (public/media/website, see provenance.json).

import { sanitizeDeck } from './spec.js';

const M = '/media/website/';
const im = (path, alt, prompt = '') => ({ src: path ? `${M}${path}` : '', alt, prompt: prompt || alt });
const S = (layout, fields = {}) => ({ layout, ...fields });

export const TEMPLATES = [
  {
    id: 'pitch', name: 'Pitch', kind: 'pitch', blurb: 'Seed round for a budgeting app',
    deck: () => ({
      title: 'Tallyfern seed round', theme: 'midnight', transition: 'morph', kind: 'pitch',
      slides: [
        S('title', { variant: 'split', eyebrow: 'Seed round · 2027', title: 'Budgets that *build themselves.*', subtitle: 'Tallyfern turns every receipt into a tidy monthly budget, automatically.', meta: 'Investor presentation · Maya Chen, CEO', image: im('app-landing/glass.webp', 'Translucent glass shapes on a pale table'), notes: 'Open with the one-line promise. Pause after the headline.' }),
        S('statement', { tone: 'ink', eyebrow: 'The problem', title: 'Most households *give up on budgeting* within three months.', subtitle: 'Not for lack of discipline. The tools ask for an hour of data entry every week.', notes: 'Example figures throughout this template. Replace them with your own.' }),
        S('imagetext', { eyebrow: 'The product', title: 'Snap it. *Sorted.*', text: 'Photograph a receipt or forward an email. Tallyfern reads it, files every line item and updates your budget before you leave the shop.', items: [{ text: 'Reads more than 40 receipt formats' }, { text: 'Splits shared purchases fairly' }, { text: 'Private by default, no bank login' }], image: im('app-landing/window.webp', 'A woman relaxing by a sunny window') }),
        S('twocol', { eyebrow: 'How it works', title: 'Three steps, *zero spreadsheets*', items: [{ title: 'Capture', text: 'Snap, forward or drop a PDF. Each receipt takes about two seconds.' }, { title: 'Sort', text: 'Line items land in the right envelope, learned from the first few you fix.' }, { title: 'Plan', text: 'A calm monthly view of what is left, not just what is gone.' }] }),
        S('bignumber', { eyebrow: 'Traction', value: '48,000', label: 'households budget with Tallyfern every month', text: 'Up from 6,000 in January, with no paid acquisition.', items: [{ value: '31%', label: 'month-over-month growth' }, { value: '4.8', label: 'average App Store rating' }, { value: '72%', label: 'still active after 90 days' }], notes: 'Lead with retention, not downloads.' }),
        S('chart', { variant: 'side', eyebrow: 'Revenue', title: 'Recurring revenue, *compounding*', text: 'Monthly recurring revenue in 2026, thousands of dollars.', chart: { type: 'bar', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], series: [{ name: 'MRR', values: [8, 11, 15, 19, 26, 34, 45, 58] }], prefix: '$', suffix: 'k' } }),
        S('pricing', { eyebrow: 'Business model', title: 'Free to start, *easy to keep*', items: [{ name: 'Free', price: '$0', period: '/mo', features: ['30 receipts a month', 'One budget'] }, { name: 'Plus', price: '$6', period: '/mo', features: ['Unlimited receipts', 'Shared household budgets', 'Export to CSV'], featured: true }, { name: 'Family', price: '$10', period: '/mo', features: ['Everything in Plus', 'Up to five members', 'Priority support'] }], note: 'Plus converts at 9.4% from free within 60 days.' }),
        S('timeline', { eyebrow: 'Roadmap', title: 'The next *18 months*', items: [{ date: 'Q1 2027', title: 'Bank-free sync', text: 'Read statements without sharing a login.' }, { date: 'Q2 2027', title: 'Family plan', text: 'Shared envelopes and allowances.' }, { date: 'Q4 2027', title: 'Android', text: 'Same app, same speed.' }, { date: '2028', title: 'Europe', text: 'Euro receipts and VAT lines.' }] }),
        S('team', { eyebrow: 'Team', title: 'Built by people who *hate data entry*', items: [{ name: 'Maya Chen', role: 'CEO · ex-fintech product lead', image: im('portfolio-timeline/portrait.webp', 'Portrait of Maya Chen') }, { name: 'Priya Raman', role: 'CTO · built receipt OCR at scale', image: im('book-launch/author.webp', 'Portrait of Priya Raman') }, { name: 'Lena Ortiz', role: 'Design · calm money apps', image: im('photographer/portrait.webp', 'Portrait of Lena Ortiz') }] }),
        S('bignumber', { variant: 'center', tone: 'accent', eyebrow: 'The ask', value: '$3M', label: 'Seed round to reach 250,000 households', items: [{ value: '40%', label: 'Product and engineering' }, { value: '35%', label: 'Growth' }, { value: '25%', label: 'Operations' }] }),
        S('closing', { eyebrow: 'Thank you', title: 'Let’s make budgeting *boring again.*', subtitle: 'We are raising now and closing in March.', cta: 'maya@tallyfern.app', contact: 'tallyfern.app' }),
      ],
    }),
  },
  {
    id: 'launch', name: 'Launch', kind: 'launch', blurb: 'Product launch for a travel app',
    deck: () => ({
      title: 'Driftwood launch', theme: 'aurora', transition: 'zoom', kind: 'launch',
      slides: [
        S('title', { variant: 'full', eyebrow: 'Introducing', title: 'Driftwood', subtitle: 'Calm weekend trips, planned in a minute, never more than two hours from home.', meta: 'Launching May 2027', image: im('app-waitlist/road.webp', 'A forest road at dusk') }),
        S('statement', { variant: 'center', eyebrow: 'Why now', title: 'The best weekends are *closer than you think.*', subtitle: 'Most of us drive straight past them on the way to somewhere further.' }),
        S('imagetext', { variant: 'left', eyebrow: 'Meet Driftwood', title: 'Tell it your mood. *Get a plan.*', text: 'Pick a vibe, a radius and a budget. Driftwood builds a two-day route with a place to sleep, somewhere to eat and one thing you would never have found.', items: [{ text: 'Offline maps for every stop' }, { text: 'Books the cabin, not just the idea' }, { text: 'Quiet hours: no notifications' }], image: im('app-waitlist/phone.webp', 'A phone glowing on a wooden table') }),
        S('twocol', { eyebrow: 'Features', title: 'Built for *slow travel*', items: [{ title: 'Mood routes', text: 'Lakes, forests, small towns or nowhere at all.' }, { title: 'Real availability', text: 'Only places with a free room this weekend.' }, { title: 'Shared trips', text: 'Plan together, split costs, keep one itinerary.' }] }),
        S('bignumber', { eyebrow: 'Waitlist', value: '21,400', label: 'people joined the waitlist in six weeks', items: [{ value: '62%', label: 'heard about us from a friend' }, { value: '4.9', label: 'beta rating from 380 testers' }] }),
        S('quote', { variant: 'portrait', quote: 'We found a lake forty minutes away that we had never heard of. It felt like a real holiday.', name: 'Sam and Theo', role: 'Beta testers, Portland', image: im('app-waitlist/porch.webp', 'A cabin porch over a lake at dusk') }),
        S('gallery', { eyebrow: 'Field notes', title: 'Weekends from the beta', items: [{ image: im('app-waitlist/porch.webp', 'Lakeside cabin'), caption: 'Lakeside cabin · 1h 20m' }, { image: im('app-waitlist/road.webp', 'Forest road'), caption: 'Forest loop · 55m' }, { image: im('manifesto/dusk-water.webp', 'Water at dusk'), caption: 'Sunset swim · 1h 40m' }] }),
        S('pricing', { eyebrow: 'Pricing', title: 'One free trip *every month*', items: [{ name: 'Free', price: '$0', period: '/mo', features: ['One planned trip a month', 'Offline maps'] }, { name: 'Wanderer', price: '$4', period: '/mo', features: ['Unlimited trips', 'Shared planning', 'Early access to cabins'], featured: true }] }),
        S('timeline', { eyebrow: 'Launch plan', title: 'From waitlist to *every weekend*', items: [{ date: 'Mar 2', title: 'Private beta', text: 'Invite the first 2,000 from the waitlist.' }, { date: 'Apr 6', title: 'Partner cabins', text: '120 hosts across Oregon and Washington.' }, { date: 'May 1', title: 'Public launch', text: 'iOS and Android, free to start.' }, { date: 'Summer', title: 'New regions', text: 'California and British Columbia.' }] }),
        S('closing', { eyebrow: 'Available May 2027', title: 'Go somewhere *quiet.*', subtitle: 'Join the waitlist and get your first month of Wanderer free.', cta: 'Join the waitlist', contact: 'driftwood.app' }),
      ],
    }),
  },
  {
    id: 'sales', name: 'Sales', kind: 'sales', blurb: 'Proposal for a commercial client',
    deck: () => ({
      title: 'Groundwork proposal for Cedar Ridge', theme: 'harvest', transition: 'push', kind: 'sales',
      slides: [
        S('title', { variant: 'split', eyebrow: 'Proposal for Cedar Ridge Office Park', title: 'Grounds that *work as hard as you do*', subtitle: 'A year-round care plan for 14 acres of lawn, beds and walkways.', meta: 'Groundwork Grounds Co. · For Dana Whitfield', image: im('local-business/hero.webp', 'A green lawn in front of a white building') }),
        S('agenda', { eyebrow: 'Today', title: 'What we will cover', items: [{ title: 'What we heard', text: 'Your goals for the campus' }, { title: 'Our plan', text: 'Four seasons of care' }, { title: 'Results', text: 'What similar parks saw' }, { title: 'Investment', text: 'Three ways to start' }, { title: 'Next steps', text: 'A walk-through in two weeks' }] }),
        S('statement', { tone: 'alt', eyebrow: 'What we heard', title: 'You want a campus tenants *notice*, without chasing three vendors.', subtitle: 'No single schedule, and patchy lawns by August.' }),
        S('imagetext', { eyebrow: 'Our approach', title: 'One crew, *one calendar*', text: 'A dedicated crew of four on site every Tuesday and Friday, a shared calendar you can see, and a monthly walk with your facilities lead.', items: [{ text: 'Mowing and edging, April to November' }, { text: 'Seasonal colour in all 22 beds' }, { text: 'Walkways cleared by 6 a.m.' }], image: im('local-business/beds.webp', 'Flower beds and a lawn in summer') }),
        S('twocol', { eyebrow: 'What you get', title: 'Everything outdoors, *handled*', items: [{ title: 'Lawn health', text: 'Soil tests, aeration and overseeding so turf stays green through August.' }, { title: 'Beds and borders', text: 'Native perennials that cut watering by a third.' }, { title: 'Winter safety', text: 'Salt, plowing and logged visits for your insurer.' }] }),
        S('bignumber', { eyebrow: 'Results at Riverside Commons', value: '34%', label: 'less water used in the first summer', text: 'Same campus size, after switching nine beds to native planting.', items: [{ value: '0', label: 'missed service days in 2026' }, { value: '98%', label: 'tenant satisfaction' }, { value: '11', label: 'years in business' }] }),
        S('chart', { variant: 'side', eyebrow: 'Proof', title: 'Turf quality, *season over season*', text: 'Average turf density score at three client parks, out of 100.', chart: { type: 'line', labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'], series: [{ name: 'With Groundwork', values: [62, 70, 78, 84, 86, 88] }, { name: 'Before', values: [60, 63, 61, 55, 50, 54] }], prefix: '', suffix: '' } }),
        S('quote', { tone: 'ink', quote: 'For the first time, nobody on our team thinks about the grounds. They just look good.', name: 'Marcus Lee', role: 'Facilities Director, Riverside Commons' }),
        S('pricing', { eyebrow: 'Investment', title: 'Three ways to *start*', items: [{ name: 'Essentials', price: '$3,900', period: '/mo', features: ['Mowing and edging', 'Spring and fall cleanup'] }, { name: 'Full care', price: '$5,600', period: '/mo', features: ['Everything in Essentials', 'Seasonal beds', 'Snow and ice'], featured: true }, { name: 'Campus+', price: '$7,400', period: '/mo', features: ['Everything in Full care', 'Irrigation management', 'Monthly reporting'] }], note: 'For 14 acres on a 12-month agreement. Snow billed at a flat rate.' }),
        S('closing', { eyebrow: 'Next steps', title: 'Let’s walk *the grounds.*', subtitle: 'A 45-minute walk-through, then a fixed quote within a week.', cta: 'Book a walk-through', contact: 'hello@groundwork.example · (319) 555-0142' }),
      ],
    }),
  },
  {
    id: 'report', name: 'Report', kind: 'report', blurb: 'Annual report with charts',
    deck: () => ({
      title: 'Quiet Hours 2026 annual report', theme: 'swiss', transition: 'fade', kind: 'report',
      slides: [
        S('title', { variant: 'plain', eyebrow: 'Annual report', title: '2026 *in review*', subtitle: 'Quiet Hours sound studio: what we made, what we learned and where we go next.', meta: 'Prepared for the board · January 2027' }),
        S('agenda', { eyebrow: 'Contents', title: 'In this report', items: [{ title: 'Headline numbers', text: '' }, { title: 'Revenue and margin', text: '' }, { title: 'Highlights', text: '' }, { title: 'What we learned', text: '' }, { title: 'Priorities for 2027', text: '' }] }),
        S('bignumber', { eyebrow: 'Headline', value: '$1.84M', label: 'revenue in 2026, up 41% on 2025', items: [{ value: '62', label: 'projects delivered' }, { value: '38%', label: 'gross margin' }, { value: '14', label: 'people on the team' }] }),
        S('chart', { variant: 'wide', eyebrow: 'Revenue', title: 'Every quarter *beat the last*', text: 'Revenue by quarter, thousands of dollars.', chart: { type: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '2025', values: [260, 300, 320, 425] }, { name: '2026', values: [350, 420, 480, 590] }], prefix: '$', suffix: 'k' } }),
        S('twocol', { variant: 'plain', eyebrow: 'Highlights', title: 'Three things that *moved the needle*', items: [{ title: 'Film scoring', text: 'Four feature films, including a festival opener.' }, { title: 'Spatial audio', text: 'A new Atmos room, booked 80% of weekdays.' }, { title: 'Education', text: 'Our evening course sold out three cohorts.' }] }),
        S('imagetext', { variant: 'left', eyebrow: 'Project spotlight', title: 'The *Listening Room*', text: 'A permanent installation for the city library: twelve speakers, forty hours of field recordings and a room where talking is optional.', items: [{ text: '31,000 visitors since June' }, { text: 'Featured in two national papers' }], image: im('manifesto/light-room.webp', 'Light falling into an empty room') }),
        S('chart', { variant: 'side', eyebrow: 'Margin', title: 'Margin recovered *after Q1*', text: 'Gross margin by quarter. Studio upgrades weighed on Q1.', chart: { type: 'line', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Gross margin', values: [29, 35, 40, 44] }], prefix: '', suffix: '%' } }),
        S('statement', { tone: 'ink', eyebrow: 'What we learned', title: 'Fewer, longer projects made us *better and more profitable.*' }),
        S('timeline', { variant: 'steps', eyebrow: '2027 priorities', title: 'Where we go *next*', items: [{ date: 'Q1', title: 'Second Atmos room', text: 'Double spatial capacity.' }, { date: 'Q2', title: 'Course online', text: 'Open the course to remote students.' }, { date: 'Q3', title: 'Games audio', text: 'First two game studio clients.' }, { date: 'Q4', title: '45% margin', text: 'Through longer engagements.' }] }),
        S('closing', { eyebrow: 'Thank you', title: 'Questions?', subtitle: 'Full financials are in the appendix shared with this deck.', cta: 'Open discussion', contact: 'board@quiethours.example' }),
      ],
    }),
  },
  {
    id: 'portfolio', name: 'Portfolio', kind: 'portfolio', blurb: 'A photographer’s portfolio',
    deck: () => ({
      title: 'Ana Ruiz portfolio', theme: 'studio', transition: 'morph', kind: 'portfolio',
      slides: [
        S('title', { variant: 'split', eyebrow: 'Portfolio 2027', title: 'Ana Ruiz, *photographer*', subtitle: 'Weddings and portraits in Austin, and wherever you are going.', meta: 'anaruiz.example', image: im('photographer/window.webp', 'A bride by a tall window') }),
        S('statement', { variant: 'center', eyebrow: 'Approach', title: 'I photograph the moments *between* the poses.' }),
        S('gallery', { eyebrow: 'Selected work', title: 'Recent weddings', items: [{ image: im('photographer/couple.webp', 'A couple laughing'), caption: 'Lake Travis, 2026' }, { image: im('photographer/dance.webp', 'A couple dancing'), caption: 'Hotel Ella, 2026' }, { image: im('photographer/lake.webp', 'A couple by a misty lake'), caption: 'Hill Country, 2025' }, { image: im('photographer/rings.webp', 'Wedding rings on linen'), caption: 'Details' }, { image: im('photographer/family.webp', 'A family walking at sunset'), caption: 'Family, 2026' }, { image: im('photographer/portrait.webp', 'The photographer with her camera'), caption: 'Self-portrait' }] }),
        S('imagetext', { eyebrow: 'Case study', title: 'Maria and Jo, *a dance-floor wedding*', text: 'Twelve hours, two cameras and one rule: no lineups. The couple received 640 edited photographs in nineteen days.', items: [{ text: 'Full-day coverage' }, { text: 'Second shooter' }, { text: 'Printed album' }], image: im('photographer/dance.webp', 'A couple dancing under string lights') }),
        S('imagetext', { variant: 'left', eyebrow: 'Portraits', title: 'Families, *unposed*', text: 'An hour outside at golden hour, with the kids in charge of where we go.', items: [], image: im('photographer/family.webp', 'A family walking at sunset') }),
        S('bignumber', { eyebrow: 'Since 2018', value: '212', label: 'weddings photographed', items: [{ value: '19', label: 'days to deliver, on average' }, { value: '5.0', label: 'rating across 140 reviews' }] }),
        S('quote', { variant: 'portrait', quote: 'Ana was invisible all day and somehow caught every moment we cared about.', name: 'Maria Delgado', role: 'Married October 2026', image: im('photographer/couple.webp', 'Maria and her partner') }),
        S('pricing', { eyebrow: 'Collections', title: 'Packages', items: [{ name: 'Portrait', price: '$650', period: 'session', features: ['One hour', '40 edited photos', 'Online gallery'] }, { name: 'Wedding', price: '$4,800', period: 'full day', features: ['Ten hours', 'Second shooter', 'Online gallery'], featured: true }, { name: 'Signature', price: '$6,900', period: 'full day', features: ['Everything in Wedding', 'Engagement session', 'Printed album'] }] }),
        S('timeline', { eyebrow: 'How it works', title: 'From hello to *heirloom*', items: [{ date: 'Week 1', title: 'Call', text: 'We talk about the day you want.' }, { date: 'Month 2', title: 'Plan', text: 'Timeline, places and the shot list.' }, { date: 'The day', title: 'Photograph', text: 'I disappear and pay attention.' }, { date: '3 weeks', title: 'Deliver', text: 'Edited gallery and prints.' }] }),
        S('closing', { variant: 'split', eyebrow: 'Booking 2027 and 2028', title: 'Let’s make something *honest.*', subtitle: 'Tell me your date and where it is.', cta: 'hello@anaruiz.example', contact: 'Austin, TX · travels worldwide', image: im('photographer/lake.webp', 'A couple by a misty lake') }),
      ],
    }),
  },
  {
    id: 'event', name: 'Event', kind: 'event', blurb: 'A one-day developer conference',
    deck: () => ({
      title: 'Prairie Code Camp 2027', theme: 'stadium', transition: 'push', kind: 'event',
      slides: [
        S('title', { variant: 'full', eyebrow: 'May 16, 2027 · Cedar Rapids', title: 'Prairie Code Camp', subtitle: 'One day of talks, workshops and good coffee for developers across the Midwest.', meta: 'Paramount Theatre', image: im('conference/hall.webp', 'A theatre stage with rows of seats') }),
        S('bignumber', { variant: 'center', eyebrow: 'The day', value: '600', label: 'developers, 24 talks, 6 workshops, 1 stage' }),
        S('statement', { eyebrow: 'Why come', title: 'Learn from people who *ship*, not people who sell.' }),
        S('agenda', { eyebrow: 'Programme', title: 'Four tracks', items: [{ title: 'Web platform', text: 'Modern CSS, edge runtimes and the boring stack' }, { title: 'Data and AI', text: 'Open models you can run yourself' }, { title: 'Craft', text: 'Testing, reviews and calm on-call' }, { title: 'Careers', text: 'Hiring, mentoring and going independent' }] }),
        S('team', { eyebrow: 'Speakers', title: 'On stage *this year*', items: [{ name: 'Noor Haddad', role: 'Interaction designer', image: im('portfolio-timeline/portrait.webp', 'Portrait of Noor Haddad') }, { name: 'June Park', role: 'Author, Small Fires', image: im('book-launch/author.webp', 'Portrait of June Park') }, { name: 'Ana Ruiz', role: 'Photographer', image: im('photographer/portrait.webp', 'Portrait of Ana Ruiz') }, { name: 'Lena Ortiz', role: 'Staff engineer', image: im('ai-product/rooftop.webp', 'Portrait of Lena Ortiz') }] }),
        S('timeline', { eyebrow: 'Schedule', title: 'May 16 *at a glance*', items: [{ date: '8:00', title: 'Doors', text: 'Coffee and badges.' }, { date: '9:00', title: 'Keynote', text: 'The boring stack wins.' }, { date: '10:30', title: 'Tracks', text: 'Four rooms, all day.' }, { date: '17:00', title: 'Lightning', text: 'Ten talks, five minutes each.' }, { date: '19:00', title: 'Party', text: 'On the patio.' }] }),
        S('imagetext', { eyebrow: 'Venue', title: 'The Paramount *Theatre*', text: 'A restored 1928 theatre downtown, two blocks from three hotels with conference rates.', items: [{ text: 'Step-free access throughout' }, { text: 'Quiet room and nursing room' }, { text: 'Live captions on every talk' }], image: im('conference/coffee.webp', 'People talking over coffee') }),
        S('pricing', { eyebrow: 'Tickets', title: 'Get your *seat*', items: [{ name: 'Student', price: '$49', period: 'day pass', features: ['All talks', 'Lunch', 'Student ID required'] }, { name: 'Standard', price: '$189', period: 'day pass', features: ['All talks and workshops', 'Lunch and party', 'Recordings'], featured: true }, { name: 'Supporter', price: '$350', period: 'day pass', features: ['Everything in Standard', 'Funds three student tickets', 'Speaker dinner'] }] }),
        S('gallery', { eyebrow: 'Last year', title: '2026 in pictures', items: [{ image: im('conference/hall.webp', 'The main stage'), caption: 'Main stage' }, { image: im('conference/coffee.webp', 'The hallway track'), caption: 'Hallway track' }, { image: im('restaurant/patio.webp', 'The patio party'), caption: 'After-party' }] }),
        S('closing', { tone: 'accent', eyebrow: 'Registration is open', title: 'See you *in May.*', subtitle: 'Early tickets end March 1.', cta: 'prairiecode.example', contact: 'Code of conduct and travel grants on the site' }),
      ],
    }),
  },
  {
    id: 'lesson', name: 'Lesson', kind: 'lesson', blurb: 'A science lesson for grade 6',
    deck: () => ({
      title: 'The water cycle', theme: 'pop', transition: 'zoom', kind: 'lesson',
      slides: [
        S('title', { variant: 'split', eyebrow: 'Science · Grade 6', title: 'The water *cycle*', subtitle: 'Where rain comes from, and where it goes next.', meta: 'Lesson 4 · 45 minutes', image: im('manifesto/dusk-water.webp', 'Still water at dusk') }),
        S('agenda', { eyebrow: 'Today', title: 'By the end of class you can', items: [{ title: 'Name the four stages', text: 'Evaporation, condensation, precipitation, collection' }, { title: 'Explain what drives it', text: 'Energy from the sun, and gravity' }, { title: 'Find it outside', text: 'Spot each stage on the way home' }] }),
        S('statement', { variant: 'center', eyebrow: 'Big idea', title: 'The water you drank today may have *fallen on a dinosaur.*', subtitle: 'Earth keeps roughly the same water. It just keeps moving.' }),
        S('timeline', { variant: 'steps', eyebrow: 'The cycle', title: 'Four stages, *one loop*', items: [{ date: '1', title: 'Evaporation', text: 'The sun warms oceans and lakes; water rises as vapour.' }, { date: '2', title: 'Condensation', text: 'Vapour cools into droplets and forms clouds.' }, { date: '3', title: 'Precipitation', text: 'Droplets join until they fall as rain, snow or hail.' }, { date: '4', title: 'Collection', text: 'Water gathers in rivers, lakes, oceans and the ground.' }] }),
        S('imagetext', { eyebrow: 'Stage 2', title: 'Condensation: *clouds from vapour*', text: 'As warm, moist air rises it cools. The vapour turns back into tiny droplets around specks of dust, and a cloud is born.', items: [{ text: 'Fog is a cloud at ground level' }, { text: 'A cold can “sweats” for the same reason' }], image: im('manifesto/fog-avenue.webp', 'An avenue in thick fog') }),
        S('bignumber', { eyebrow: 'Did you know', value: '97%', label: 'of Earth’s water is salty ocean water', items: [{ value: '2%', label: 'frozen in ice and glaciers' }, { value: '1%', label: 'fresh water we can use' }] }),
        S('chart', { variant: 'side', eyebrow: 'Data', title: 'Rainfall *by season*', text: 'Average rainfall in our town, in millimetres.', chart: { type: 'bar', labels: ['Winter', 'Spring', 'Summer', 'Autumn'], series: [{ name: 'Rainfall', values: [210, 160, 70, 190] }], prefix: '', suffix: ' mm' } }),
        S('twocol', { eyebrow: 'Compare', title: 'Weather vs *climate*', items: [{ title: 'Weather', text: 'What the sky is doing today: a rainy Tuesday.' }, { title: 'Climate', text: 'The pattern over thirty years: wet winters, dry summers.' }] }),
        S('agenda', { variant: 'plain', tone: 'alt', eyebrow: 'Activity', title: 'Make a cloud *in a jar*', items: [{ title: 'Pour warm water into a jar', text: 'About a third full' }, { title: 'Put ice on the lid', text: 'The cold makes vapour condense' }, { title: 'Add a puff of air spray', text: 'It gives droplets something to grab' }, { title: 'Watch and write', text: 'What did you see, and which stage was it?' }] }),
        S('closing', { eyebrow: 'Exit ticket', title: 'Which stage *are you* when you sweat?', subtitle: 'Write one sentence on a sticky note before you leave.', cta: 'Homework: page 42', contact: 'Next lesson: weather fronts' }),
      ],
    }),
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id);
/** A fresh copy of a template as a valid deck (new ids each time). */
export function templateDeck(id) {
  const t = templateById(id) || TEMPLATES[0];
  return sanitizeDeck({ ...t.deck(), id: undefined });
}
