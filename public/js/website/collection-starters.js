import { COLLECTION_TEMPLATES } from './collection-list.js';
// Original, editable demo brands. Uses the same schema and export path as every user site.
import { templateSite, newSection, sanitizeSite } from './spec.js';
const photo = (folder, name, alt) => ({ src: `/media/website/${folder}/${name}.webp`, alt, prompt: '' });
const p = {
  garden: photo('local-business','beds','Layered green planting beside a garden path'),
  leaves: photo('local-business','leaves','Autumn leaves gathered in a garden'),
  home: photo('property-story','hero','A timber and stone house beside a still lake'),
  interior: photo('property-story','detail','Warm architectural details and natural materials'),
  studio: photo('wellness-studio','hero','A light-filled movement studio'),
  ritual: photo('wellness-studio','detail','Linen, clay and quiet everyday objects'),
  coast: photo('manifesto','dusk-water','A shoreline at dusk'),
  city: photo('manifesto','fog-avenue','An avenue disappearing into fog'),
  room: photo('manifesto','light-room','Sunlight moving across a quiet room'),
  stage: photo('music-artist','hero','A singer performing beneath indigo and amber lights'),
  sound: photo('music-artist','detail','Close-up details from a recording session'),
  map: photo('portfolio-timeline','map','A thoughtfully designed map interface'),
  field: photo('portfolio-timeline','field','A field notebook interface for outdoor research'),
  reading: photo('portfolio-timeline','reading','A calm digital reading experience'),
  camera: photo('portfolio-timeline','camera','A minimal camera product study'),
  glass: photo('app-landing','glass','An abstract glass form in studio light'),
  motion: photo('app-landing','motion','A study of color and movement'),
  hall: photo('conference','hall','An open event hall ready for a gathering'),
  coffee: photo('conference','coffee','Coffee and conversation at an event'),
  jacket: photo('editorial-shop','field-jacket-black','A black field jacket'),
  coat: photo('editorial-shop','wool-coat-olive','An olive wool coat'),
  shirt: photo('editorial-shop','overshirt-stone','A stone-colored overshirt'),
  food: photo('restaurant','tacos','Fresh tacos with lime and herbs'),
  dining: photo('restaurant','room','A warmly lit restaurant dining room'),
  kitchen: photo('restaurant','kitchen','A working restaurant kitchen'),
  couple: photo('photographer','couple','A couple together in warm natural light'),
  dance: photo('photographer','dance','A wedding celebration on the dance floor'),
  lake: photo('photographer','lake','An intimate celebration beside the lake'),
  book: photo('book-launch','book','A terracotta hardcover beside a seedling'),
  author: photo('book-launch','author','An author reading in a library'),
};

// Metadata is exported separately from builders so the gallery remains a small data module.


export function buildCollectionStarter(id) {
  const cfg=COLLECTION_TEMPLATES.find(t=>t.id===id); if(!cfg)return null;
  const site=templateSite({prompt:cfg.title,kind:cfg.kind,style:cfg.style});
  site.name=cfg.title.split(' · ')[0]; site.tagline=cfg.description;
  site.contact={email:'',phone:'',address:'',form:''};
  site.collections={posts:[],listings:[],tracks:[],menu:[]};
  site.theme.motion='lively';
  site.seo={...site.seo,title:cfg.title,description:cfg.description,url:''};
  site.nav.cta={label:'Get in touch',href:'#contact'};
  const s=(type,variant,data={},tone='base')=>({...newSection(type,site),...(type==='chapters'?{eyebrow:''}:{}),...data,variant,tone});
  const l=(label,href='#contact')=>({label,href});
  const hero=(variant,title,subtitle,image,cta='Explore',anchor='#about',extra={})=>s('hero',variant,{eyebrow:cfg.title,title,subtitle,image,cta:l(cta,anchor),cta2:l('Get in touch'),note:'',...extra});
  const about=(title,text,image,variant='split')=>s('about',variant,{anchor:'about',eyebrow:'Our approach',title,text,image,points:[],cta:l('Start a conversation')},'alt');
  const statement=text=>s('statement','reveal',{eyebrow:'',text,note:''});
  const gallery=(title,images,variant='masonry')=>s('gallery',variant,{anchor:'gallery',eyebrow:'A closer look',title,subtitle:'',items:images.map(([image,caption])=>({image,caption}))});
  const features=(title,items,variant='icons')=>s('features',variant,{anchor:'services',eyebrow:'What we do',title,subtitle:'',items:items.map(([title,text,image],i)=>({title,text,image,icon:['sun','sparkle','heart'][i%3]}))});
  const steps=(title,items,variant='steps')=>s('timeline',variant,{eyebrow:'The process',title,subtitle:'',items:items.map(([title,text],i)=>({date:String(i+1).padStart(2,'0'),title,text}))},'alt');
  const ticker=items=>s('logos','marquee',{title:'',items:items.map(name=>({name}))},'acc');
  const contact=s('contact','split',{anchor:'contact',eyebrow:'Make it happen',title:'Let’s start a conversation.',text:'Tell us a little about what you have in mind. We will take it from there.',hours:'',button:'Open email to send'},'alt');
  const footer=s('footer','simple',{tagline:cfg.description,social:[]});
  let a=[];
  switch(id){
    case 'fern-gardens':
      Object.assign(site.theme,{palette:'meadow',accent:'#286044',radius:24});
      a=[hero('split','A little more\n*outside.*','Thoughtful gardens for everyday life. Planting, care and places to slow down.',p.garden,'See our approach'),features('Good things\n*take root.*',[
        ['Planting design','Layered planting that changes beautifully through the seasons.'],['Garden care','Practical visits that keep a garden feeling cared for.'],['Small transformations','One border, one courtyard or a new way into the outdoors.']]),gallery('Room to *grow.*',[[p.garden,'A welcoming path'],[p.leaves,'Working with the seasons'],[p.coast,'Space to breathe']],'strip'),about('Start with\nwhat is *there.*','We listen to how you use your space, look closely at the light and choose an approach that belongs to the place.',p.leaves),steps('From first visit to first bloom.',[['Walk together','Talk about the space and the way you want to use it.'],['Make a plan','Agree the planting, scope and seasonal priorities.'],['Let it grow','Build in stages and care for what comes next.']])]; break;
    case 'haven-retreat':
      Object.assign(site.theme,{palette:'noir',mode:'dark',accent:'#d8c39d',radius:0});
      a=[hero('cover','Find your\n*own pace.*','A lakeside place for long mornings, shared meals and a little distance from the everyday.',p.home,'Explore Haven'),statement('Some places ask you to do more. This one gives you room to *be.*'),about('Days without\na *rush.*','Start by the water. Spend the afternoon with a book. Meet around a table as the light begins to change.',p.room),gallery('Stay a *little longer.*',[[p.home,'At the water’s edge'],[p.interior,'Natural materials'],[p.coast,'Evening light']]),s('schedule','columns',{title:'A day at Haven',subtitle:'Sample retreat itinerary; confirm dates and availability with your host.',items:[{day:'Morning',time:'09:00',title:'Slow start',text:'Tea, a walk and time by the water.'},{day:'Afternoon',time:'14:00',title:'Your own rhythm',text:'Read, explore or simply rest.'},{day:'Evening',time:'18:00',title:'Around the table',text:'Gather for a seasonal meal.'}]})]; break;
    case 'margin-journal':
      Object.assign(site.theme,{palette:'paper',accent:'#a33c2e',radius:0});
      a=[hero('editorial','Worth a\n*second read.*','An independent journal about places, people and the small details that stay with us.',p.book,'Inside this edition','#chapters'),s('chapters','split',{title:'In this edition',items:[{title:'The long way home',text:'A walk through familiar streets, noticing what we usually pass by.',motif:'orbit'},{title:'Objects with a past',text:'The things we keep and the stories we give them.',motif:'wave'},{title:'A table for everyone',text:'What happens when we make a little room for someone new.',motif:'grid'}]}),about('A slower kind\nof *attention.*','Margin makes space for stories that need more than a headline. Every edition begins with a question and ends with a conversation.',p.author),statement('Look closely. Ask better questions. Leave room in the *margin.*')]; break;
    case 'frame-interiors':
      Object.assign(site.theme,{palette:'stone',accent:'#795d45',radius:8});
      a=[hero('mosaic','Space to\n*feel at home.*','Interiors shaped by light, texture and the way you actually live.',p.interior,'Our approach','#about',{images:[p.room,p.home,p.ritual].map(image=>({image}))}),gallery('Rooms with *room to live.*',[[p.home,'A quieter home'],[p.room,'Light as a material'],[p.interior,'Details that belong']]),about('A home is\nnever *finished.*','We work with what you love, what you need and what the building already gives you. The result should feel personal from the first day.',p.ritual),steps('A considered process.',[['Discover','Walk through the spaces and the everyday routines.'],['Shape','Bring materials, plans and ideas into focus.'],['Complete','Resolve the details together.']])]; break;
    case 'signal-podcast':
      Object.assign(site.theme,{palette:'void',mode:'dark',accent:'#edb66b',radius:12});
      a=[hero('kinetic','Good talks.\n*New frequencies.*','Signal is a space for people making things, changing direction and finding their own voice.',p.sound,'Meet the show'),ticker(['Listen closely','Ask again','Follow the story']),s('chapters','stack',{anchor:'episodes',title:'On the listening list',items:[{title:'Finding your own sound',text:'A conversation about starting before you feel ready.',motif:'wave'},{title:'The work between the work',text:'Rituals, revisions and the ideas that survive them.',motif:'orbit'}]}),about('One question\nopens *another.*','Signal is an independent podcast concept. Add your own episodes, audio and guest details to make it yours.',p.stage),statement('Stay curious. Leave the conversation a little *changed.*')]; break;
    case 'northline-travel':
      Object.assign(site.theme,{palette:'paper',accent:'#405e6d',radius:0});
      a=[hero('cover','Take the\n*long way.*','Small journeys, quiet stays and places that deserve a little more time.',p.coast,'Choose your direction','#gallery'),gallery('Three ways to *get lost.*',[[p.coast,'Along the water'],[p.city,'Before the city wakes'],[p.home,'Somewhere to stay']],'strip'),steps('A different kind of itinerary.',[['Arrive slowly','Leave the first afternoon open.'],['Follow a local story','Choose one neighborhood, one path, one conversation.'],['Bring something back','A recipe, a photograph or a new way of seeing.']],'vertical'),about('Less checklist.\nMore *connection.*','Northline is a travel journal and itinerary concept. Tell your own stories and add your own booking links when ready.',p.city)]; break;
    case 'fieldwork-outdoors':
      Object.assign(site.theme,{palette:'chalk',accent:'#58613b',radius:2});
      a=[hero('split','Made for\n*getting out.*','Useful layers. Quiet details. A collection for the routes you take every day.',p.jacket,'View the collection','#shop'),ticker(['Wear often','Look after it','Take the long way']),s('products','lineup',{title:'The everyday collection',subtitle:'Concept collection. Add your real prices and checkout links before selling.',items:[[p.jacket,'Field jacket'],[p.coat,'Wool layer'],[p.shirt,'Everyday overshirt']].map(([image,name])=>({image,name,price:'Enquire',note:'Concept piece',link:l('Ask about this piece')}))}),s('lookbook','offset',{title:'Outside, in your own way.',items:[{image:p.coast,caption:'A slower route',note:''},{image:p.garden,caption:'Close to home',note:''}]}),statement('The best thing in your wardrobe is the thing you actually *wear.*')]; break;
    case 'index-advisory':
      Object.assign(site.theme,{palette:'snow',accent:'#244ba0',radius:0,spacing:'airy'});
      a=[hero('minimal','Clarity is\na *competitive edge.*','Independent advice for teams deciding what comes next.',p.map,'How we help','#services'),features('Make the next move *count.*',[
        ['Position','Find a clear place in the market and a story your team can use.',p.map],['Prioritize','Turn a long list of possibilities into a practical next step.',p.reading],['Align','Bring the people doing the work into the same conversation.',p.hall]],'rows'),statement('A useful strategy fits on a page and shows up in the *work.*'),steps('Questions before answers.',[['Understand','Listen to the business and the people closest to the work.'],['Decide','Make the choices and tradeoffs explicit.'],['Move','Set a short plan and review what happens.']]),about('A thinking partner.\nAn *outside perspective.*','Index is a consulting practice concept. Replace these examples with your own services and evidence.',p.reading,'centered')]; break;
    case 'folio-learning':
      Object.assign(site.theme,{palette:'paper',accent:'#b14c30',radius:20});
      a=[hero('stack','Learn a little.\n*Make a lot.*','Practical workshops for curious people. Leave with something you have made and a way to keep going.',p.reading,'Explore the curriculum','#curriculum',{images:[p.book,p.field].map(image=>({image}))}),s('chapters','split',{anchor:'curriculum',title:'From curiosity to confidence.',items:[{title:'See the possibilities',text:'Explore examples and choose a small, achievable project.',motif:'grid'},{title:'Try it yourself',text:'Make a first version with clear guidance and room to experiment.',motif:'wave'},{title:'Keep going',text:'Leave with a practical next step and resources to return to.',motif:'orbit'}]}),about('Small groups.\nRoom to *ask.*','Folio is a workshop concept built around doing. Add real dates, teacher biographies and booking details before opening enrolment.',p.hall),s('faq','accordion',{title:'Before you begin',items:[{q:'Who are the workshops for?',a:'Curious beginners. Describe the prerequisites and equipment for your actual course here.'},{q:'How do I join?',a:'Send an enquiry to ask about upcoming dates and available places.'}]})]; break;
    case 'form-architecture':
      Object.assign(site.theme,{palette:'gallery',accent:'#646d58',radius:0});
      a=[hero('editorial','Built around\n*the everyday.*','An architecture practice exploring space, light and the life between walls.',p.home,'Selected projects','#work'),s('cases','rail',{title:'Places to inhabit.',items:[[p.home,'Water house','2026'],[p.room,'Light room','2025'],[p.interior,'Material study','2024']].map(([image,title,year])=>({image,title,year,role:'Concept study',client:'Form',text:'An exploration of light, material and daily life.',credits:'Original concept imagery',link:l('Discuss a project')}))}),statement('Begin with the place. Listen to the people. Let the building *belong.*'),about('Good buildings\nmake good *neighbors.*','Our starting point is the experience of being somewhere. We study how a space is used, how light moves and how it can grow with the people who use it.',p.interior)]; break;
    case 'common-table':
      Object.assign(site.theme,{palette:'paper',accent:'#9d4a32',radius:16});
      site.collections.menu=[{id:'dish-one',title:'From the garden',category:'To begin',text:'Seasonal greens, herbs and a bright dressing.',price:'Ask for today’s menu'},{id:'dish-two',title:'From the kitchen',category:'To share',text:'A generous plate built around what is in season.',price:'Ask for today’s menu'}];
      a=[hero('split','There is room\nat our *table.*','Seasonal food, good company and a kitchen that feels like part of the neighborhood.',p.food,'Meet the kitchen'),about('Cook with care.\nServe with *warmth.*','Start with good ingredients. Keep the cooking honest. Make everyone feel welcome. That is the idea behind Common Table.',p.kitchen),s('menu','columns',{title:'A taste of the kitchen',subtitle:'Sample menu. Ask the team about the current menu and dietary needs.'}),gallery('Come as you *are.*',[[p.food,'Made to share'],[p.dining,'Stay for another conversation'],[p.kitchen,'From our kitchen']],'strip')]; break;
    case 'orbit-developer':
      Object.assign(site.theme,{palette:'aurora',mode:'dark',accent:'#a9b8ff',radius:16});
      a=[hero('ambient','Less setup.\nMore *building.*','A developer workspace concept for bringing ideas, tools and the next useful step together.',p.glass,'Explore the workflow','#services'),features('A clear path\nfrom idea to *release.*',[
        ['One place to start','Keep a concise brief and a visible definition of done.',p.map],['Make changes small','Review a focused change before moving on.',p.motion],['Check the result','Preview the experience at the sizes your customers use.',p.reading]],'bento'),s('annotated','wide',{title:'Keep the work in view.',subtitle:'A visual concept for your product story. Add real product screenshots before launch.',status:'Product concept',image:p.glass,items:[{label:'A clear starting point'},{label:'Visible progress'},{label:'Review before release'}]}),steps('Build a useful loop.',[['Describe','Write the outcome and constraints.'],['Build','Make one meaningful change.'],['Verify','Check behavior, layout and accessibility.']]),statement('Shipping starts with knowing what *good* looks like.')]; break;
    case 'echo-festival':
      Object.assign(site.theme,{palette:'pop',accent:'#e54442',radius:0});
      a=[hero('reel','Find your\n*people.*','A gathering for live music, new ideas and conversations that carry on after the lights go down.',p.stage,'Explore the day','#schedule',{images:[p.hall,p.coffee,p.sound].map(image=>({image}))}),ticker(['Music','Ideas','Food','Good company']),s('schedule','list',{title:'One day. A lot to discover.',subtitle:'Sample running order. Replace with confirmed dates, artists and venue details.',items:[{day:'Festival day',time:'14:00',title:'Doors open',text:'Find a spot, meet a friend, settle in.'},{day:'Festival day',time:'16:00',title:'New voices',text:'An afternoon of music and conversation.'},{day:'Festival day',time:'20:00',title:'After dark',text:'The evening comes alive.'}]}),about('More than\na *lineup.*','Echo is a festival concept for people who like discovering something together. Bring your real artists, dates and ticketing links to make it happen.',p.hall),statement('One room. Many voices. Something *shared.*')]; break;
    case 'vow-celebrations':
      Object.assign(site.theme,{palette:'stone',accent:'#82604c',radius:4});
      a=[hero('portrait','Your people.\nYour *kind of day.*','Thoughtful planning for celebrations that feel entirely like you.',p.couple,'Our approach'),about('All the details.\nAll the *feeling.*','We begin with what matters to you, then bring the pieces together with care. A little structure makes more room for the moments you want to remember.',p.lake),gallery('The moments *between.*',[[p.couple,'A quiet moment'],[p.dance,'Let the evening unfold'],[p.lake,'Together, outside']]),steps('Make room for joy.',[['Meet','Talk about the people, the place and your priorities.'],['Plan','Build a practical plan around the way you want the day to feel.'],['Celebrate','Let the preparations make room for being present.']],'vertical')]; break;
    case 'still-life':
      Object.assign(site.theme,{palette:'linen',accent:'#475b59',radius:28});
      a=[hero('object','Keep the\n*small moments.*','A photo journal concept about paying attention. Fewer distractions, more of what is in front of you.',p.camera,'Meet the idea','#demo'),s('annotated','portrait',{title:'Only what matters.',subtitle:'An original photo journal concept. Replace with your product’s verified features.',status:'Design concept',image:p.camera,items:[{label:'A familiar shape'},{label:'An intentional detail'},{label:'Room to focus'}]}),statement('The photograph begins before you press the *button.*'),gallery('A way of *seeing.*',[[p.room,'Follow the light'],[p.city,'Notice the familiar'],[p.coast,'Wait a little longer']],'strip'),about('An everyday\n*companion.*','Still Life explores the tools that help us look more closely. It is a starting point for a product story of your own.',p.room)]; break;
  }
  site.pages=[{...site.pages[0],title:'Home',slug:'',sections:[...a,contact,footer]}];
  site.seo.image=a[0].image;
  return sanitizeSite(site,site,{source:'user'});
}
