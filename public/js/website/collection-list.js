// Template metadata shared by the gallery and public catalog.
export const COLLECTION_TEMPLATES = [
  ['fern-gardens','Fern · Gardens','Seasonal planting, a gallery and a clear enquiry path.','friendly','business','Garden parallax'],
  ['haven-retreat','Haven · Retreat','A lakeside escape with spaces and visit enquiries.','luxe','event','Immersive cover'],
  ['margin-journal','Margin · Journal','An independent journal with an editorial opening.','editorial','launch','Editorial reveal'],
  ['frame-interiors','Frame · Interiors','Layered images, material stories and a project archive.','studio','portfolio','Perspective mosaic'],
  ['signal-podcast','Signal · Podcast','Episode notes, a host story and guest enquiries.','bold','band','Kinetic headline'],
  ['northline-travel','Northline · Travel','A cinematic destination guide with a visual itinerary.','editorial','portfolio','Landscape parallax'],
  ['fieldwork-outdoors','Fieldwork · Outdoors','An outdoor label with a lookbook and collection enquiries.','editorial-shop','shop','Lookbook motion'],
  ['index-advisory','Index · Advisory','A focused consulting practice and service story.','swiss','business','Word reveal'],
  ['folio-learning','Folio · Learning','Practical workshops, a curriculum and enrolment enquiries.','friendly','landing','Layered cards'],
  ['form-architecture','Form · Architecture','An architectural portfolio with a sideways project rail.','portfolio-timeline','cases','Project rail'],
  ['common-table','Common Table · Dining','A kitchen story, sample menu and reservation enquiries.','studio','restaurant','Warm parallax'],
  ['orbit-developer','Orbit · Developer','An ambient product page with a getting-started guide.','aurora','product','Ambient field'],
  ['echo-festival','Echo · Festival','Live music, a cinematic reel and a sample running order.','bold','event','Film strip'],
  ['vow-celebrations','Vow · Celebrations','A wedding studio, story gallery and thoughtful planning.','studio','event','Portrait reveal'],
  ['still-life','Still Life · Objects','A quiet photo journal with a floating product hero.','ai-product','product','Floating object'],
].map(([id,title,description,style,kind,motionLabel])=>({id,title,description,style,kind,motionLabel,isNew:true}));
