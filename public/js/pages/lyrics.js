import { LOOKS, MAX_SONG_SECONDS, cleanCues, fromTranscript, parseLyrics, cueAt, cropScore, toLrc, toSrt, analyzeBands, estimateBeat } from '../lyrics-engine.js';
import { encodeWav } from '../audio-engine.js';
import { apiFetch } from '../human.js';
import { ASR_LANGS, shiftResult } from '../transcribe.js';
import { exportMusic } from '../music-export.js';
import { soundCheck, hasSound } from '../aac.js';
import { generateLyricVideo, directLyrics } from '../lyric-generation.js';
import { wordsFrom, alignLyrics, promptFrom } from '../lyric-align.js';
import { drawMotion, planScenes, autoPictureCount } from '../lyric-motion.js';
import { writePrompts, paintScenes } from '../lyric-scenes.js';

const $ = s => document.querySelector(s);
const canvas = $('#lyric-canvas'), audio = $('#song-audio');
const demoCues = [
  {start:0,end:4,text:'We are made of little moments'},
  {start:4,end:8,text:'Let the quiet turn to color'},
  {start:8,end:12,text:'Tonight we become the light',emphasis:true},
  {start:12,end:16,text:'And carry it home'},
];
let cues = structuredClone(demoCues), score, buffer, analysis, art, originalFile;
let soundOK = 'unknown', look = 'kinetic', busy = false, cancel, demo = true, trackURL, resultURL, artURL;
let playhead = 4.7, context, pendingFile, view = 'welcome';
// Every word Whisper heard, with times. Pasted lyrics borrow these times instead of being spaced evenly.
let heard = [];
// Scenes and their pictures. A picture entry is { image, url, prompt } or null (built-in art is used).
let scenes = [], pictures = [], paintSeed = Math.floor(Math.random() * 1e6);
// A line whose words are spread evenly from `from`, so previews animate word by word.
function timedLine(text,start,end,step){const words=text.split(' ').map((w,i)=>({text:w,start:start+.2+i*step,end:start+.2+(i+1)*step}));return {text,start,end,words};}
const welcomeLine=timedLine('We are made of little moments',0,4.2,.32);
const message = text => { $('#status').textContent = text; };
const format = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2,'0')}`;
const duration = () => score?.duration || 16;
const config = () => ({cues,look,title:$('#song-title').value || 'Little moments',artist:$('#artist').value,analysis,art,motion:$('#motion').value==='on',shapes:$('#shapes').value!=='off',scenes:scenes.length?scenes:planScenes(cues,duration(),1),images:pictures.map(p=>p?.image||null),duration:duration()});
const pictureCount = () => { const v=$('#pictures').value; return v==='auto'?autoPictureCount(duration()):Number(v)||0; };
function invalidate() {
  if(resultURL) URL.revokeObjectURL(resultURL);
  resultURL = null; $('#download-video').hidden = true; $('#back-to-result').disabled = true;
  $('#finished-video').pause(); $('#finished-video').removeAttribute('src'); $('#download-result').removeAttribute('href');
}
function setBusy(on, cancellable = false) {
  busy = on;
  document.querySelectorAll('.lyric-studio input,.lyric-studio select,.lyric-studio textarea,.lyric-studio button').forEach(e => { e.disabled = on; });
  $('#cancel-task').hidden = !cancellable;
  $('#cancel-task').disabled = false;
  $('#cancel-generation').disabled = false;
  $('#generating').setAttribute('aria-busy', String(on));
  if(!on) {
    for(const id of ['play','scrub','apply-lyrics','add-line']) $('#'+id).disabled = !score;
    $('#transcribe').disabled = !originalFile || demo;
    $('#export-video').disabled = !score || !cues.length;
    $('#back-to-result').disabled = !resultURL;
  }
}
function render(t = playhead) {
  drawMotion(canvas,t,config());
  $('#scrub').value = t;
  $('#time-display').textContent = `${format(t)} / ${format(duration())}`;
  const index = cueAt(cues,t);
  $('#cue-list').querySelectorAll('.cue').forEach((e,i) => e.classList.toggle('active',i===index));
}
function seek(t) {
  playhead = Math.max(0,Math.min(duration(),t));
  if(score) audio.currentTime = playhead;
  render();
}
function pause() { audio.pause(); $('#play').textContent='▶'; $('#play').setAttribute('aria-label','Play preview'); }
async function play() {
  if(!score || busy) return;
  if(!audio.paused) { pause(); return; }
  if(audio.currentTime >= duration()-.04) seek(0);
  try { await audio.play(); $('#play').textContent='Ⅱ'; $('#play').setAttribute('aria-label','Pause preview'); }
  catch { message('Press play again to enable audio in your browser.'); }
}
function waveform() {
  const el = $('#waveform'), c = el.getContext('2d'); c.clearRect(0,0,el.width,el.height);
  c.fillStyle='#e5a2c0';
  for(let i=0;i<150;i++) {
    const j = Math.floor(i / 150 * (analysis?.bands[0].length || 1));
    const value = analysis ? (analysis.bands[0][j]+analysis.bands[1][j]+analysis.bands[2][j])/3 : .15+Math.abs(Math.sin(i*.47))*.4;
    const h = 2 + value * 32; c.fillRect(i*6,(38-h)/2,3,h);
  }
}
function styleThumbs() {
  $('#looks').replaceChildren();
  for(const item of LOOKS) {
    const button=document.createElement('button'); button.type='button';button.className='look';button.dataset.look=item.id;
    button.setAttribute('aria-pressed',String(look===item.id));
    const thumb=document.createElement('canvas');thumb.width=480;thumb.height=270;thumb.setAttribute('aria-hidden','true');
    const sample=item.id==='paper'?'stay a little longer':item.id==='matter'?'feel the frequency':item.id==='architecture'?'words have weight':item.id==='orbit'?'in your orbit':item.id==='echo'?'meet your future':'make me feel';
    drawMotion(thumb,1.6,{cues:[timedLine(sample,0,5,.15)],look:item.id,title:'',motion:true,images:[pictures.find(Boolean)?.image||null],scenes:[{start:0,end:5,index:0,seed:LOOKS.indexOf(item)+2,move:'push',transition:'zoom'}],duration:5});
    const title=document.createElement('strong');title.textContent=item.name;
    const detail=document.createElement('span');detail.textContent=item.detail;
    button.append(thumb,title,detail);button.addEventListener('click',()=>{look=item.id;invalidate();$('#look-name').textContent=item.name.toUpperCase();$('#looks').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
    $('#looks').append(button);
  }
}
function changedCues() {
  invalidate(); render(); $('#export-video').disabled = busy || !score || !cues.length;
}
function buildCueList() {
  const list=$('#cue-list'); list.replaceChildren();
  cues.forEach((cue,i)=>{
    const row=document.createElement('div');row.className='cue';
    const number=document.createElement('button'); number.className='cue-number';number.type='button';number.textContent=String(i+1).padStart(2,'0');number.setAttribute('aria-label',`Seek to line ${i+1}`);number.onclick=()=>seek(cue.start);
    const times=document.createElement('div');times.className='cue-times';
    for(const key of ['start','end']) {
      const label=document.createElement('label');label.textContent=key==='start'?'IN':'OUT';
      const input=document.createElement('input');input.type='number';input.min='0';input.max=duration();input.step='.01';input.value=cue[key].toFixed(2);input.setAttribute('aria-label',`${key} of line ${i+1}`);
      const update=()=>{
        const n=Number(input.value);
        const lower=key==='start'?(cues[i-1]?.end||0):cue.start+.02;
        const upper=key==='start'?cue.end-.02:(cues[i+1]?.start??duration());
        if(!Number.isFinite(n)||n<lower||n>upper){input.value=cue[key].toFixed(2);message(`Keep this ${key} between ${lower.toFixed(2)} and ${upper.toFixed(2)} seconds.`);return;}
        cue[key]=n;delete cue.words;changedCues();
      };
      input.addEventListener('change',update); label.append(input);times.append(label);
      const tap=document.createElement('button');tap.type='button';tap.textContent=key==='start'?'Start here':'End here';tap.setAttribute('aria-label',`${key==='start'?'Start':'End'} line ${i+1} at playhead`);tap.onclick=()=>{input.value=playhead.toFixed(2);update();};label.append(tap);
    }
    const words=document.createElement('div'), text=document.createElement('textarea');text.rows=2;text.maxLength=500;text.value=cue.text;text.setAttribute('aria-label',`Lyric line ${i+1}`);
    text.oninput=()=>{cue.text=text.value;if(cue.words?.length!==text.value.trim().split(/\s+/).filter(Boolean).length)delete cue.words;else cue.words=cue.words.map((w,j)=>({...w,text:text.value.trim().split(/\s+/)[j]}));changedCues();};
    const emphasis=document.createElement('label');emphasis.className='cue-emphasis';const check=document.createElement('input');check.type='checkbox';check.checked=!!cue.emphasis;check.onchange=()=>{cue.emphasis=check.checked;changedCues();};emphasis.append(check,document.createTextNode('Chorus emphasis'));words.append(text,emphasis);
    const remove=document.createElement('button');remove.type='button';remove.className='cue-delete';remove.textContent='×';remove.setAttribute('aria-label',`Delete line ${i+1}`);remove.onclick=()=>{cues.splice(i,1);buildCueList();changedCues();};
    row.append(number,times,words,remove);list.append(row);
  });
}
function adoptScore(value) {
  score=value;analysis=analyzeBands(score.channels,score.sampleRate);analysis.beat=estimateBeat(analysis);playhead=0;
  $('#scrub').max=duration();$('#clip-start').max=Math.max(0,duration()-.1);$('#clip-start').value=0;
  waveform();invalidate();render();
}
function showView(next) {
  view = next;
  for (const id of ['welcome','generating','generation-error','finished','editor']) $('#'+id).hidden = id !== next;
  window.scrollTo({top:0,behavior:'instant'});
  const heading = $('#'+next).querySelector('h1');
  if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
function ensureActive(signal) { if(signal?.aborted) throw new DOMException('Cancelled','AbortError'); }
async function openSong(file, signal) {
  if(file.size>50*1024*1024) throw new Error('Choose a song smaller than 50 MB.');
  context ||= new AudioContext({sampleRate:48000});
  const decoded=await context.decodeAudioData(await file.arrayBuffer());
  ensureActive(signal);
  if(decoded.duration<.5 || decoded.duration>MAX_SONG_SECONDS) throw new Error('Choose audio between half a second and 6 minutes.');
  buffer=decoded; originalFile=file;demo=false;cues=[];heard=[];clearPictures();pictureNote='';
  if(trackURL)URL.revokeObjectURL(trackURL);trackURL=URL.createObjectURL(file);audio.src=trackURL;
  $('#song-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,60);$('#artist').value='';
  $('#clip-length').value='full';
  if(artURL)URL.revokeObjectURL(artURL);artURL=null;art=null;$('#art-file').value='';$('#remove-art').hidden=true;
  adoptScore({sampleRate:decoded.sampleRate,channels:Array.from({length:Math.min(2,decoded.numberOfChannels)},(_,i)=>decoded.getChannelData(i)),duration:decoded.duration});
  $('#song-info').textContent=`${file.name} · ${format(duration())}`;
  $('#preview-kind').textContent='YOUR SONG';buildCueList();
}
async function loadSong(file) {
  if(!file || busy)return;
  pendingFile=file;score=null;buffer=null;cues=[];originalFile=null;demo=false;
  await runGeneration({file});
}
async function prepareDemo(signal) {
  const {renderScore}=await import('../score.js');
  const value=await renderScore({style:'trap',bpm:120,beats:32,dropBeat:16,endBeat:28,seed:212045});value.duration=16;
  ensureActive(signal);
  if(trackURL)URL.revokeObjectURL(trackURL);trackURL=URL.createObjectURL(encodeWav(value.channels,value.sampleRate));audio.src=trackURL;
  originalFile=null;buffer=null;pendingFile=null;demo=true;cues=structuredClone(demoCues);$('#song-title').value='Little moments';$('#artist').value='';$('#clip-length').value='full';
  adoptScore(value);buildCueList();$('#preview-kind').textContent='DESIGN DEMO';$('#song-info').textContent='Original instrumental · 16 seconds · no vocals';$('#timing-note').textContent='Example words with an original instrumental. These words are not sung.';
}
async function loadDemo() { if(!busy)await runGeneration({demoMode:true}); }
async function transcribeSong(signal) {
  if(!buffer || !originalFile) throw new Error('Choose a song to start.');
  const offline=new OfflineAudioContext(1,Math.ceil(buffer.duration*16000),16000), source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
  const mono=await offline.startRendering();ensureActive(signal);
  const typed=$('#welcome-lyrics').value.trim();
  const q=new URLSearchParams({mode:'lyrics'});if($('#language').value)q.set('lang',$('#language').value);if(typed)q.set('prompt',promptFrom(typed));
  const response=await apiFetch('/api/transcribe?'+q,{method:'POST',headers:{'content-type':'audio/wav'},body:encodeWav([mono.getChannelData(0)],16000),signal});
  const data=await response.json();ensureActive(signal);if(!response.ok)throw new Error(data.error||'We couldn’t hear the words clearly. Try again, or add your lyrics below.');
  const result=shiftResult({...data,duration:duration()},0);
  heard=wordsFrom(result.segments);
  const matched=typed&&heard.length?alignLyrics(typed,heard,duration()):null;
  const next=matched&&matched.matched>=.3?cleanCues(matched.cues,duration()):fromTranscript(result.segments,duration());
  if(!next.length)throw new Error('We couldn’t find lyrics in this track. Try a version with clearer vocals, or add your lyrics below.');
  cues=next;buildCueList();invalidate();seek(0);
  $('#timing-note').textContent=matched&&matched.matched>=.3?`Your lyrics, timed to the vocal. ${Math.round(matched.matched*100)}% of your words were heard clearly; the rest sit between them.`:'Automatic lyrics, timed word by word. Fix any word below, or paste your lyrics to keep the timing and swap in your exact words.';
}
function clearPictures(){for(const p of pictures)if(p?.url)URL.revokeObjectURL(p.url);pictures=[];scenes=[];}
// Plan the scenes and paint any that don't have a picture yet. Existing pictures are kept when the
// number of scenes is unchanged, so editing words or timing never repaints the video.
async function paintPictures(signal){
  const count=pictureCount(),next=planScenes(cues,duration(),Math.max(1,count||1),analysis?.beat);
  const keep=next.length===scenes.length&&pictures.length===next.length?pictures:(clearPictures(),new Array(next.length).fill(null));
  scenes=next;pictures=keep;
  if(!count||demo){buildSceneStrip();return;}
  const missing=pictures.map((p,i)=>p?-1:i).filter(i=>i>=0);
  if(missing.length){
    const {prompts}=await writePrompts({scenes,cues,title:$('#song-title').value,apiFetch,signal});
    scenePrompts=prompts;
    const bar=$('#generation-progress');
    const {pictures:painted,limitHit}=await paintScenes({prompts:missing.map(i=>prompts[i]),apiFetch,signal,seed:paintSeed,onProgress:(d,total)=>{$('#generation-status').textContent=`Painting scene ${d} of ${total}…`;bar.value=Math.round(d/total*100);}});
    missing.forEach((i,k)=>{pictures[i]=painted[k];});
    pictureNote=limitHit||'';
  }
  buildSceneStrip();styleThumbs();
}
let scenePrompts=[],pictureNote='';
function buildSceneStrip(){
  const strip=$('#scene-strip');if(!strip)return;strip.replaceChildren();
  $('#scene-note').textContent=pictureNote||(pictures.some(Boolean)?'Each scene has its own picture and camera move. Swap any of them.':'Built-in art is used. Choose a number of pictures in Video settings, or add your own here.');
  scenes.forEach((sc,i)=>{
    const card=document.createElement('div');card.className='scene-card';
    const thumb=document.createElement('div');thumb.className='scene-thumb';if(pictures[i]?.url)thumb.style.backgroundImage=`url(${pictures[i].url})`;
    const label=document.createElement('span');label.textContent=`Scene ${i+1} · ${format(sc.start)} · ${({push:'push in',pull:'pull back',spin:'360 spin',pan:'pan',orbit:'orbit',tilt:'tilt'})[sc.move]}`;
    const again=document.createElement('button');again.type='button';again.className='text-button';again.textContent='New picture';
    again.onclick=async()=>{if(busy)return;setBusy(true);message(`Painting scene ${i+1}…`);try{const prompt=scenePrompts[i]||(await writePrompts({scenes,cues,title:$('#song-title').value,apiFetch})).prompts[i];const r=await paintScenes({prompts:[prompt],apiFetch,seed:Math.floor(Math.random()*1e6)});if(r.pictures[0]){if(pictures[i]?.url)URL.revokeObjectURL(pictures[i].url);pictures[i]=r.pictures[0];invalidate();buildSceneStrip();styleThumbs();render();message(`New picture for scene ${i+1}. Save changes to update your video.`);}else message(r.limitHit||'Couldn’t paint that one. Try again.');}finally{setBusy(false);}};
    const own=document.createElement('label');own.className='file-button';own.textContent='Use my image';const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
    input.onchange=async()=>{const f=input.files[0];if(!f)return;if(f.size>15*1024*1024){message('Use an image smaller than 15 MB.');return;}try{const image=await createImageBitmap(f);if(pictures[i]?.url)URL.revokeObjectURL(pictures[i].url);pictures[i]={image,url:URL.createObjectURL(f),prompt:'your image'};invalidate();buildSceneStrip();render();}catch{message('Could not read that image. Try JPG, PNG or WebP.');}};
    own.append(input);
    const row=document.createElement('div');row.className='lyric-row';row.append(again,own);
    card.append(thumb,label,row);strip.append(card);
  });
}
function generationStage(stage, progress) {
  const text={prepare:'Opening your song…',transcribe:'Listening for every word…',compose:'Bringing the words and motion together…',paint:'Painting a picture for every scene…',render:'Making your video…'};
  $('#generation-status').textContent=stage==='render' && Number.isFinite(progress)?`Making your video · ${Math.round(progress*100)}%`:text[stage];
  const bar=$('#generation-progress');
  if(stage==='render'&&Number.isFinite(progress))bar.value=Math.round(progress*100);else bar.removeAttribute('value');
}
async function runGeneration({file, demoMode=false, reuseLyrics=false}={}) {
  if(busy)return;
  pause();$('#finished-video').pause();setBusy(true,true);cancel=new AbortController();const signal=cancel.signal;
  $('#generation-track').textContent=file?.name || (demoMode?'An original design demo':$('#song-title').value);
  showView('generating');
  try {
    await generateLyricVideo({
      signal,onStage:generationStage,
      prepare:file?()=>openSong(file,signal):demoMode?()=>prepareDemo(signal):null,
      transcribe:!demoMode&&!reuseLyrics?()=>transcribeSong(signal):null,
      compose:()=>{if(!score||!cues.some(c=>c.text.trim()))throw new Error('Add lyrics before making this video.');if(!reuseLyrics)cues=directLyrics(cues);buildCueList();},
      paint:()=>paintPictures(signal),
      render:renderVideo,
    });
    $('#finished-song').textContent=$('#song-title').value;
    $('#finished-details').textContent=`${format(duration())} song · ${LOOKS.find(l=>l.id===look).name} · ${pictures.filter(Boolean).length?pictures.filter(Boolean).length+' AI pictures':'built-in art'} · ${soundOK==='silent'?'No sound in this browser':soundOK==='ok'?'Original audio · sound checked':'Original audio'}`;
    $('#finished-note').textContent=soundOK==='silent'?'This browser saved the video without sound. Open chucksi.com/lyrics in Chrome or Edge to export it with your song.':demo?'Original instrumental with sample words, not sung vocals. Upload your song to make your own.':'Give it a listen before sharing. You can correct any words or timing in Edit video.';
    showView('finished');
  } catch(e) {
    const stopped=signal.aborted;
    $('#error-title').innerHTML=stopped?'Whenever you’re ready.<br><em>Pick it back up.</em>':'Let’s give it<br><em>another take.</em>';
    $('#generation-error-message').textContent=stopped?'Generation stopped. Your song and any completed lyrics are still here.':e.message;
    $('#retry-generation').hidden=!pendingFile&&!score;
    $('#recovery-lyrics').hidden=!score;
    showView('generation-error');
  } finally {setBusy(false);cancel=null;}
}
async function transcribe() { if(!busy)await runGeneration(); }
function applyLyrics(text) {
  if(!score){message('Add your song or try the demo first.');return;}
  let result=parseLyrics(text,duration()),aligned=null;
  // Plain lyrics after a transcription: keep the heard timing, use the typed words.
  if(result.estimated&&heard.length){aligned=alignLyrics(text,heard,duration());if(aligned.matched>=.3)result={cues:cleanCues(aligned.cues,duration()),estimated:false};else aligned=null;}
  if(!result.cues.length){message('No lyrics found. Add a phrase on each line.');return;}
  cues=result.cues;buildCueList();changedCues();
  $('#timing-note').textContent=aligned?`Your words, timed to the vocal. ${Math.round(aligned.matched*100)}% matched what we heard; the rest sit between them.`:result.estimated?'Timing is evenly spaced as a starting point. Adjust each phrase to the vocal before export.':'Imported timestamps. Listen through to check the phrasing and timing.';
  message(`${cues.length} lines added. Your lyrics are editable below.`);
}
function download(blob,name) {const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function fileName(ext) {return ($('#song-title').value||'chucksi-lyrics').replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,60)+'.'+ext;}
async function renderVideo(signal, onProgress) {
  if(!score)throw new Error('Choose a song to start.');
  const start=Math.max(0,Math.min(duration()-.1,Number($('#clip-start').value)||0));
  const length=Math.min(duration()-start,$('#clip-length').value==='full'?duration():Number($('#clip-length').value));
  if(!cues.some(c=>c.text.trim()&&c.start<start+length&&c.end>start))throw new Error('This excerpt has no lyrics. Choose a start time inside a lyric line.');
  invalidate();await document.fonts.ready;ensureActive(signal);
  const target=document.createElement('canvas');target.width=canvas.width;target.height=canvas.height;
  const settings={...config(),cues:cleanCues(cues,duration())};
  const blob=await exportMusic({canvas:target,draw:(el,t)=>drawMotion(el,start+t,settings),score:cropScore(score,start,length),duration:length,signal,onProgress});
  ensureActive(signal);
  const clip=cropScore(score,start,length);
  soundOK=length<=240&&hasSound(clip.channels)?await soundCheck(blob):'unknown'; // a full decode of long songs costs too much memory on phones
  resultURL=URL.createObjectURL(blob);
  for(const id of ['download-video','download-result']){const link=$('#'+id);link.href=resultURL;link.download=fileName('mp4');link.hidden=false;}
  $('#finished-video').src=resultURL;
  message(soundOK==='silent'?'Your video is ready, but this browser saved it without sound. Open chucksi.com/lyrics in Chrome or Edge to export it with your song.':`Your ${length.toFixed(1)}-second video is ready. Original audio included.`);
  render();return blob;
}
async function exportVideo() { await runGeneration({reuseLyrics:true}); }
function setShape() {
  const dims={wide:[1280,720],portrait:[720,1280],square:[720,720]}[$('#shape').value];
  [canvas.width,canvas.height]=dims;$('.canvas-wrap').className='canvas-wrap '+$('#shape').value;invalidate();render();
}
$('#song-file').onchange=e=>loadSong(e.target.files[0]);
$('#upload-song').onchange=e=>loadSong(e.target.files[0]);
$('#try-demo').onclick=loadDemo;
$('#cancel-generation').onclick=()=>{cancel?.abort();$('#generation-status').textContent='Stopping…';};
$('#retry-generation').onclick=()=>runGeneration({file:score?null:pendingFile,reuseLyrics:!!score&&!!cues.length,demoMode:!score&&!pendingFile});
$('#edit-result').onclick=()=>{$('#finished-video').pause();showView('editor');};
$('#back-to-result').onclick=()=>{pause();if(resultURL)showView('finished');};
function startOver(){pause();$('#finished-video').pause();$('#upload-song').value='';showView('welcome');}
$('#new-song').onclick=startOver;$('#replace-song').onclick=startOver;
$('#generate-from-lyrics').onclick=()=>{const parsed=parseLyrics($('#recovery-text').value,duration());if(!parsed.cues.length){$('#generation-error-message').textContent='Paste at least one lyric line to continue.';return;}applyLyrics($('#recovery-text').value);runGeneration({reuseLyrics:true});};
const uploadZone=$('#upload-zone');
for(const type of ['dragenter','dragover'])uploadZone.addEventListener(type,e=>{e.preventDefault();uploadZone.classList.add('dragging');});
for(const type of ['dragleave','drop'])uploadZone.addEventListener(type,e=>{e.preventDefault();uploadZone.classList.remove('dragging');});
uploadZone.addEventListener('drop',e=>loadSong(e.dataTransfer.files[0]));
$('#load-demo').onclick=loadDemo;$('#play').onclick=play;$('#transcribe').onclick=transcribe;
$('#cancel-task').onclick=()=>{cancel?.abort();message('Cancelling…');};$('#export-video').onclick=exportVideo;
$('#scrub').oninput=e=>seek(Number(e.target.value));audio.onended=()=>{pause();playhead=duration();render();};
$('#shape').onchange=setShape;
for(const id of ['song-title','artist','motion','shapes','clip-start','clip-length','pictures']) $('#'+id).addEventListener('input',()=>{invalidate();render();});
$('#apply-lyrics').onclick=()=>applyLyrics($('#paste-lyrics').value);
$('#lyrics-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>500000){message('Use a subtitle file smaller than 500 KB.');return;}try{const text=await f.text();$('#paste-lyrics').value=text;applyLyrics(text);}catch{message('Could not read that subtitle file.');}};
$('#add-line').onclick=()=>{
  const start=Math.min(playhead,duration()-.1), next=cues.find(c=>c.start>=start), previous=cues.findLast(c=>c.start<start);
  const end=Math.min(start+3,next?.start??duration());
  if((previous&&previous.end>start)||end-start<.05){message('Move the playhead into a gap between lines, then add a line.');return;}
  cues=cleanCues([...cues,{start,end,text:'Your next line'}],duration());buildCueList();changedCues();
};
$('#art-file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;if(f.size>15*1024*1024){message('Use artwork smaller than 15 MB.');return;}
  setBusy(true);let url;
  try{url=URL.createObjectURL(f);const image=new Image();image.src=url;await image.decode();if(artURL)URL.revokeObjectURL(artURL);artURL=url;art=image;$('#remove-art').hidden=false;invalidate();render();}
  catch{if(url)URL.revokeObjectURL(url);message('Could not read that artwork. Try JPG, PNG or WebP.');}finally{setBusy(false);}
};
$('#remove-art').onclick=()=>{art=null;if(artURL)URL.revokeObjectURL(artURL);artURL=null;$('#art-file').value='';$('#remove-art').hidden=true;invalidate();render();};
$('#save-srt').onclick=()=>download(new Blob([toSrt(cleanCues(cues,duration()))],{type:'text/plain'}),fileName('srt'));
$('#save-lrc').onclick=()=>download(new Blob([toLrc(cleanCues(cues,duration()))],{type:'text/plain'}),fileName('lrc'));
$('#save-project').onclick=()=>download(new Blob([JSON.stringify({version:1,duration:duration(),cues:cleanCues(cues,duration()),look,title:$('#song-title').value,artist:$('#artist').value,shape:$('#shape').value,motion:$('#motion').value},null,2)],{type:'application/json'}),fileName('json'));
$('#project-file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;if(!score){message('Attach the original song before opening its project.');return;}
  if(f.size>2*1024*1024){message('That project is too large.');return;}
  try{
    const p=JSON.parse(await f.text());if(p.version!==1||!Array.isArray(p.cues))throw new Error('Choose a Chucksi lyric project.');
    if(!Number.isFinite(p.duration)||Math.abs(p.duration-duration())>.5)throw new Error('This project belongs to a different track length. Attach its original song first.');
    const next=cleanCues(p.cues,duration());cues=next;look=LOOKS.some(l=>l.id===p.look)?p.look:'kinetic';
    $('#song-title').value=String(p.title||'').slice(0,60);$('#artist').value=String(p.artist||'').slice(0,60);
    $('#shape').value=['wide','portrait','square'].includes(p.shape)?p.shape:'wide';$('#motion').value=p.motion==='off'?'off':'on';
    setShape();styleThumbs();$('#look-name').textContent=LOOKS.find(l=>l.id===look).name.toUpperCase();buildCueList();changedCues();
    $('#timing-note').textContent='Project restored. Reattach any artwork used in this design.';message('Lyrics, timing and style restored.');
  }catch(e){message(e.message);}
};
for(const [value,label] of ASR_LANGS){const option=document.createElement('option');option.value=value;option.textContent=label;$('#language').append(option);}
if(matchMedia('(prefers-reduced-motion: reduce)').matches)$('#motion').value='off';
await document.fonts.ready;
styleThumbs();buildCueList();setBusy(false);waveform();render();
let welcomeFrame=0;
function tick(now){
  if(view==='welcome'&&now-welcomeFrame>40){welcomeFrame=now;const still=matchMedia('(prefers-reduced-motion: reduce)').matches;drawMotion($('#welcome-art'),still?3:(now/1000)%4.6,{cues:[welcomeLine],look:'kinetic',title:'',motion:!still,scenes:[{start:0,end:4.6,index:0,seed:3,move:'spin',transition:'zoom'}],duration:4.6});}
  if(view==='editor'&&!audio.paused&&!busy){playhead=audio.currentTime;render();}
  requestAnimationFrame(tick);
}requestAnimationFrame(tick);
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{pause();cancel?.abort();});
