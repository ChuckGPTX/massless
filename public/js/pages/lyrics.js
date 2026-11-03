import { LOOKS, MAX_SONG_SECONDS, cleanCues, fromTranscript, parseLyrics, cueAt, cropScore, toLrc, toSrt, analyzeBands, drawLyrics } from '../lyrics-engine.js';
import { encodeWav } from '../audio-engine.js';
import { apiFetch } from '../human.js';
import { ASR_LANGS, shiftResult } from '../transcribe.js';
import { exportMusic } from '../music-export.js';

const $ = s => document.querySelector(s);
const canvas = $('#lyric-canvas'), audio = $('#song-audio');
const demoCues = [
  {start:0,end:4,text:'We are made of little moments'},
  {start:4,end:8,text:'Let the quiet turn to color'},
  {start:8,end:12,text:'Tonight we become the light',emphasis:true},
  {start:12,end:16,text:'And carry it home'},
];
let cues = structuredClone(demoCues), score, buffer, analysis, art, originalFile;
let look = 'kinetic', busy = false, cancel, demo = true, trackURL, resultURL, artURL;
let playhead = 4.7, context, trackGeneration = 0;
const message = text => { $('#status').textContent = text; };
const format = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2,'0')}`;
const duration = () => score?.duration || 16;
const config = () => ({cues,look,title:$('#song-title').value || 'Little moments',artist:$('#artist').value,analysis,art,motion:$('#motion').value==='on'});
function invalidate() {
  if(resultURL) URL.revokeObjectURL(resultURL);
  resultURL = null; $('#download-video').hidden = true;
}
function setBusy(on, cancellable = false) {
  busy = on;
  document.querySelectorAll('.lyric-studio input,.lyric-studio select,.lyric-studio textarea,.lyric-studio button').forEach(e => { e.disabled = on; });
  $('#cancel-task').hidden = !cancellable;
  $('#cancel-task').disabled = false;
  if(!on) {
    for(const id of ['play','scrub','apply-lyrics','add-line']) $('#'+id).disabled = !score;
    $('#transcribe').disabled = !originalFile || demo;
    $('#export-video').disabled = !score || !cues.length;
  }
}
function render(t = playhead) {
  drawLyrics(canvas,t,config());
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
    drawLyrics(thumb,2,{cues:[{start:0,end:5,text:item.id==='paper'?'stay a little longer':item.id==='matter'?'feel the frequency':item.id==='architecture'?'words have weight':item.id==='orbit'?'in your orbit':item.id==='echo'?'meet your future':'make me feel'}],look:item.id,title:'',motion:true});
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
    text.oninput=()=>{cue.text=text.value;delete cue.words;changedCues();};
    const emphasis=document.createElement('label');emphasis.className='cue-emphasis';const check=document.createElement('input');check.type='checkbox';check.checked=!!cue.emphasis;check.onchange=()=>{cue.emphasis=check.checked;changedCues();};emphasis.append(check,document.createTextNode('Chorus emphasis'));words.append(text,emphasis);
    const remove=document.createElement('button');remove.type='button';remove.className='cue-delete';remove.textContent='×';remove.setAttribute('aria-label',`Delete line ${i+1}`);remove.onclick=()=>{cues.splice(i,1);buildCueList();changedCues();};
    row.append(number,times,words,remove);list.append(row);
  });
}
function adoptScore(value) {
  score=value;analysis=analyzeBands(score.channels,score.sampleRate);playhead=0;
  $('#scrub').max=duration();$('#clip-start').max=Math.max(0,duration()-.1);$('#clip-start').value=0;
  waveform();invalidate();render();
}
async function loadSong(file) {
  if(!file || busy) return;
  if(file.size>50*1024*1024){message('Choose a song smaller than 50 MB.');return;}
  pause();setBusy(true);message('Opening your song…');
  const generation=++trackGeneration;
  try {
    context ||= new AudioContext({sampleRate:48000});
    const decoded=await context.decodeAudioData(await file.arrayBuffer());
    if(decoded.duration<.5 || decoded.duration>MAX_SONG_SECONDS) throw new Error('Choose audio between half a second and 6 minutes.');
    if(generation!==trackGeneration)return;
    buffer=decoded; originalFile=file;demo=false;cues=[];
    if(trackURL)URL.revokeObjectURL(trackURL);trackURL=URL.createObjectURL(file);audio.src=trackURL;
    $('#song-title').value=file.name.replace(/\.[^.]+$/,'');
    adoptScore({sampleRate:decoded.sampleRate,channels:Array.from({length:Math.min(2,decoded.numberOfChannels)},(_,i)=>decoded.getChannelData(i)),duration:decoded.duration});
    $('#song-info').textContent=`${file.name} · ${format(duration())} · ready`;
    $('#preview-kind').textContent='YOUR SONG';$('#timing-note').textContent='Transcribe or paste lyrics to start. Review every phrase against the vocal.';
    buildCueList();message('Song ready. Transcribe it, or paste your own lyrics.');
  }catch(e){message(`Could not open this song. ${e.message}`);}finally{setBusy(false);}
}
async function loadDemo() {
  if(busy)return;
  pause();setBusy(true);message('Preparing the original instrumental demo…');
  try {
    const {renderScore}=await import('../score.js');
    const value=await renderScore({style:'trap',bpm:120,beats:32,dropBeat:16,endBeat:28,seed:212045});value.duration=16;
    if(trackURL)URL.revokeObjectURL(trackURL);trackURL=URL.createObjectURL(encodeWav(value.channels,value.sampleRate));audio.src=trackURL;
    originalFile=null;buffer=null;demo=true;cues=structuredClone(demoCues);$('#song-title').value='Little moments';$('#artist').value='';
    adoptScore(value);buildCueList();$('#preview-kind').textContent='DESIGN DEMO';$('#song-info').textContent='Original instrumental · 16 seconds · no vocals';$('#timing-note').textContent='Example words with an original instrumental. These words are not sung.';
    message('Demo ready. Play it, change the look, or export a sample.');
  }catch(e){message(e.message);}finally{setBusy(false);}
}
async function transcribe() {
  if(!buffer || !originalFile || busy)return;
  pause();setBusy(true,true);cancel=new AbortController();message('Listening to your song… You can cancel while this runs.');
  try {
    const offline=new OfflineAudioContext(1,Math.ceil(buffer.duration*16000),16000), source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
    const mono=await offline.startRendering();if(cancel.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const q=new URLSearchParams({mode:'lyrics'});if($('#language').value)q.set('lang',$('#language').value);
    const response=await apiFetch('/api/transcribe?'+q,{method:'POST',headers:{'content-type':'audio/wav'},body:encodeWav([mono.getChannelData(0)],16000),signal:cancel.signal});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Transcription could not finish.');
    if(cancel.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const result=shiftResult({...data,duration:duration()},0);
    const next=fromTranscript(result.segments,duration());
    if(!next.length)throw new Error('No words were found. Try pasting your lyrics instead.');
    cues=next;buildCueList();invalidate();seek(0);
    $('#timing-note').textContent='Automatic draft. Long segments use estimated phrase spacing. Listen, correct misheard words and adjust the IN / OUT times.';
    message(`${cues.length} lyric lines ready to review. Check the words and timing before exporting.`);
  }catch(e){message(e.name==='AbortError'?'Transcription cancelled. Your current lyrics are unchanged.':e.message);}finally{setBusy(false);cancel=null;}
}
function applyLyrics(text) {
  if(!score){message('Add your song or try the demo first.');return;}
  const result=parseLyrics(text,duration());
  if(!result.cues.length){message('No lyrics found. Add a phrase on each line.');return;}
  cues=result.cues;buildCueList();changedCues();
  $('#timing-note').textContent=result.estimated?'Timing is evenly spaced as a starting point. Adjust each phrase to the vocal before export.':'Imported timestamps. Listen through to check the phrasing and timing.';
  message(`${cues.length} lines added. Your lyrics are editable below.`);
}
function download(blob,name) {const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function fileName(ext) {return ($('#song-title').value||'chucksi-lyrics').replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,60)+'.'+ext;}
async function exportVideo() {
  if(busy||!score)return;
  const start=Math.max(0,Math.min(duration()-.1,Number($('#clip-start').value)||0));
  const length=Math.min(duration()-start,$('#clip-length').value==='full'?duration():Number($('#clip-length').value));
  if(!cues.some(c=>c.text.trim()&&c.start<start+length&&c.end>start)){message('This excerpt has no lyrics. Choose a start time inside a lyric line.');return;}
  pause();setBusy(true,true);cancel=new AbortController();invalidate();message('Preparing your MP4…');
  try {
    await document.fonts.ready;
    const target=document.createElement('canvas');target.width=canvas.width;target.height=canvas.height;
    const settings={...config(),cues:cleanCues(cues,duration())};
    const blob=await exportMusic({canvas:target,draw:(el,t)=>drawLyrics(el,start+t,settings),score:cropScore(score,start,length),duration:length,signal:cancel.signal,onProgress:p=>message(`Rendering your video · ${Math.round(p*100)}%`)});
    resultURL=URL.createObjectURL(blob);$('#download-video').href=resultURL;$('#download-video').download=fileName('mp4');$('#download-video').hidden=false;
    message(`Your ${length.toFixed(1)}-second MP4 is ready. Original audio included.`);
  }catch(e){message(e.message);}finally{setBusy(false);cancel=null;render();}
}
function setShape() {
  const dims={wide:[1280,720],portrait:[720,1280],square:[720,720]}[$('#shape').value];
  [canvas.width,canvas.height]=dims;$('.canvas-wrap').className='canvas-wrap '+$('#shape').value;invalidate();render();
}
$('#song-file').onchange=e=>loadSong(e.target.files[0]);$('#load-demo').onclick=loadDemo;$('#play').onclick=play;$('#transcribe').onclick=transcribe;
$('#cancel-task').onclick=()=>{cancel?.abort();message('Cancelling…');};$('#export-video').onclick=exportVideo;
$('#scrub').oninput=e=>seek(Number(e.target.value));audio.onended=()=>{pause();playhead=duration();render();};
$('#shape').onchange=setShape;
for(const id of ['song-title','artist','motion','clip-start','clip-length']) $('#'+id).addEventListener('input',()=>{invalidate();render();});
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
function tick(){if(!audio.paused&&!busy){playhead=audio.currentTime;render();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{pause();cancel?.abort();});
