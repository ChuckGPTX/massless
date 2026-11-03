// Deterministic lyric timing and rendering. No network, hidden generation or third-party artwork.
export const LOOKS = [
  {id:'kinetic',name:'Big feelings',detail:'Oversized words. Sharp entrances. Electric pink.',color:'#ff5b9c'},
  {id:'paper',name:'After hours',detail:'An intimate, ink-on-paper lyric journal.',color:'#df7c4d'},
  {id:'orbit',name:'In your orbit',detail:'Type floats inside a moving constellation.',color:'#b7a2ff'},
  {id:'matter',name:'Sound becomes matter',detail:'Bass, mids and treble sculpt a living landscape.',color:'#b9f66b'},
  {id:'architecture',name:'Type architecture',detail:'Dimensional lettering above a moving skyline.',color:'#78d9ff'},
  {id:'echo',name:'Future echo',detail:'A tunnel of lyric afterimages and liquid light.',color:'#ffb55b'},
];
export const MAX_SONG_SECONDS=360;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function cleanCues(input,duration){
  if(!Number.isFinite(duration)||duration<=0)throw new Error('Load a track first.');
  return input.map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text??'').trim().slice(0,500),words:s.words,emphasis:Boolean(s.emphasis)}))
    .filter(s=>s.text&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.start<duration&&s.end>0)
    .sort((a,b)=>a.start-b.start).map((s,i,all)=>{
      const start=Math.max(0,s.start),end=Math.min(duration,s.end,all[i+1]?.start??duration);
      const words=Array.isArray(s.words)?s.words.map(w=>({text:String(w.text??w.word??'').trim(),start:Number(w.start),end:Number(w.end)})).filter(w=>w.text&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start&&w.start>=start&&w.end<=end):[];
      return {start,end,text:s.text,emphasis:s.emphasis,...(words.length?{words}:{} )};
    }).filter(s=>s.end>s.start).slice(0,500);
}
export function fromTranscript(segments,duration){
  const chunks=[];
  for(const s of cleanCues(segments,duration)){
    const tokens=s.text.split(/\s+/); const timed=s.words?.length===tokens.length;
    for(let i=0;i<tokens.length;i+=7){const n=Math.min(tokens.length,i+7);chunks.push({text:tokens.slice(i,n).join(' '),start:timed?s.words[i].start:s.start+(s.end-s.start)*i/tokens.length,end:timed?s.words[n-1].end:s.start+(s.end-s.start)*n/tokens.length,...(timed?{words:s.words.slice(i,n)}:{})});}
  }
  return cleanCues(chunks,duration);
}
export function parseLyrics(text,duration){
  const source=String(text).replace(/\r/g,'').trim();
  const time=s=>s.replace(',','.').split(':').reduce((a,n)=>a*60+Number(n),0);
  const srt=[...source.matchAll(/([\d:]+[.,]\d+)\s*-->\s*([\d:]+[.,]\d+)[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g)].map(m=>({start:time(m[1]),end:time(m[2]),text:m[3].replace(/\n/g,' ')}));
  if(srt.length)return {cues:cleanCues(srt,duration),estimated:false};
  const lrc=[];
  for(const line of source.split('\n')){const stamps=[...line.matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g)];const content=line.replace(/\[[^\]]*\]/g,'').trim();for(const m of stamps)if(content)lrc.push({start:time(m[1]),text:content});}
  if(lrc.length){lrc.sort((a,b)=>a.start-b.start);return{cues:cleanCues(lrc.map((s,i)=>({...s,end:lrc[i+1]?.start??duration})),duration),estimated:false};}
  const lines=source.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,500);
  return {cues:cleanCues(lines.map((text,i)=>({text,start:i*duration/lines.length,end:(i+1)*duration/lines.length})),duration),estimated:true};
}
export function cueAt(cues,t){return cues.findIndex(c=>t>=c.start&&t<c.end);}
export function cropScore(score,start,duration){
  const a=Math.round(start*score.sampleRate),n=Math.round(duration*score.sampleRate);
  return {sampleRate:score.sampleRate,channels:score.channels.map(x=>x.subarray(a,a+n)),duration};
}
export function toLrc(cues){return cues.map(c=>{const cs=Math.round(c.start*100);return `[${String(Math.floor(cs/6000)).padStart(2,'0')}:${((cs%6000)/100).toFixed(2).padStart(5,'0')}]${c.text}`;}).join('\n');}
export function toSrt(cues){const t=n=>{const ms=Math.round(n*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};return cues.map((c,i)=>`${i+1}\n${t(c.start)} --> ${t(c.end)}\n${c.text}\n`).join('\n');}
// Three one-pole crossover bands, RMS every 20 ms. A real audio envelope, not a pretend BPM detector.
export function analyzeBands(channels,rate,fps=50){
  const n=channels[0].length,hop=Math.max(1,Math.round(rate/fps)),count=Math.ceil(n/hop);
  const bands=[new Float32Array(count),new Float32Array(count),new Float32Array(count)];
  const a=1-Math.exp(-2*Math.PI*180/rate),b=1-Math.exp(-2*Math.PI*2500/rate);let low=0,upper=0;
  for(let i=0;i<n;i++){let x=0;for(const ch of channels)x+=ch[i]/channels.length;low+=a*(x-low);upper+=b*(x-upper);const k=Math.floor(i/hop);bands[0][k]+=low*low;bands[1][k]+=(upper-low)**2;bands[2][k]+=(x-upper)**2;}
  for(const band of bands){let peak=0;for(let k=0;k<count;k++){band[k]=Math.sqrt(band[k]/hop);peak=Math.max(peak,band[k]);}if(peak>.00001)for(let k=0;k<count;k++)band[k]/=peak;}
  return {bands,fps};
}
function linesFor(ctx,text,max){const out=[];let line='';for(const w of text.split(/\s+/)){const next=line?line+' '+w:w;if(line&&ctx.measureText(next).width>max){out.push(line);line=w;}else line=next;}if(line)out.push(line);return out;}
function fitted(ctx,text,width,height,font,max){let size=max,lines;do{ctx.font=`${font} ${size}px ${font==='italic'?'Georgia':'"Instrument Sans", sans-serif'}`;lines=linesFor(ctx,text,width);if(lines.length*size*1.15<=height&&lines.every(l=>ctx.measureText(l).width<=width))break;size-=2;}while(size>2);return{lines,size};}
export function drawLyrics(canvas,t,{cues=[],look='kinetic',title='Your song. Your world.',artist='',analysis,art,motion=true}={}){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,unit=Math.min(w,h),index=cueAt(cues,t),cue=cues[index],theme=LOOKS.find(l=>l.id===look)||LOOKS[0],accent=theme.color;
  const k=Math.floor(t*(analysis?.fps||50));const energy=analysis?.bands.map(b=>b[k]||0)||[.32,.4,.25];
  const a=motion?energy[0]:.2,b=motion?energy[1]:.2,c=motion?energy[2]:.2,phase=motion?t:0;
  ctx.clearRect(0,0,w,h);ctx.fillStyle=look==='paper'?'#eee6d5':'#101018';ctx.fillRect(0,0,w,h);
  if(art){const scale=Math.max(w/art.width,h/art.height)*(1+.025*Math.sin(phase*.3));ctx.globalAlpha=look==='paper'?.13:.32;ctx.drawImage(art,(w-art.width*scale)/2,(h-art.height*scale)/2,art.width*scale,art.height*scale);ctx.globalAlpha=1;}
  if(look==='kinetic'||look==='echo'||look==='orbit'){
    const g=ctx.createRadialGradient(w*(.5+.25*Math.sin(phase*.2)),h*.35,0,w*.5,h*.5,Math.max(w,h)*.85);g.addColorStop(0,look==='kinetic'?'#742151':look==='echo'?'#683110':'#302155');g.addColorStop(1,'#101018');ctx.globalAlpha=art?.55:1;ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.globalAlpha=1;
  }
  if(look==='orbit')for(let i=0;i<32;i++){const angle=i*2.399+phase*.035,r=unit*(.24+(i%7)*.045);ctx.fillStyle=i%5?accent:'#fff';ctx.globalAlpha=.15+(i%4)*.09;ctx.beginPath();ctx.arc(w/2+Math.cos(angle)*r,h/2+Math.sin(angle)*r*1.25,1+(i%3)+c*3,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
  if(look==='matter'||look==='architecture'){
    ctx.strokeStyle='#ffffff12';ctx.lineWidth=1;for(let i=0;i<14;i++){const y=h*.67+i*i*h*.0017;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();ctx.beginPath();ctx.moveTo(w/2,h*.57);ctx.lineTo((i-6)*w*.26,h);ctx.stroke();}
    for(let i=0;i<25;i++){const x=i*w/24,bh=unit*(.03+Math.abs(Math.sin(i*.7+phase*.4))*.13+(i%3===0?a:i%3===1?b:c)*.2);ctx.fillStyle=i%3===0?accent:i%3===1?'#327ca7':'#283d5d';ctx.globalAlpha=.55;ctx.fillRect(x,h*.87-bh,w/32,bh);}
    ctx.globalAlpha=1;
  }
  if(look==='paper'){ctx.strokeStyle='#c9bda7';ctx.lineWidth=1;for(let y=h*.2;y<h*.88;y+=unit*.08){ctx.beginPath();ctx.moveTo(w*.08,y);ctx.lineTo(w*.92,y);ctx.stroke();}ctx.fillStyle=accent;ctx.fillRect(w*.08,h*.12,unit*.05,unit*.05);}
  if(cue?.emphasis&&look!=='paper'){ctx.strokeStyle=accent;ctx.lineWidth=unit*.006;ctx.strokeRect(w*.04,h*.16,w*.92,h*.59);}
  const fg=look==='paper'?'#25231f':'#f5f2eb';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=look==='paper'?'#796b59':'#b4adb9';ctx.font=`500 ${unit*.021}px "Instrument Sans", sans-serif`;ctx.fillText(artist.slice(0,45).toUpperCase(),w*.08,h*.08);
  ctx.textAlign='right';ctx.fillText(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`,w*.9,h*.08);
  const text=cue?.text||(!cues.length||t<cues[0].start?title:''),style=look==='paper'?'italic':'700';const fit=fitted(ctx,look==='paper'?text:text.toUpperCase(),w*.8,h*.44,style,unit*(look==='kinetic'?.125:.095)*(cue?.emphasis?1.18:1));
  const p=cue?clamp((t-cue.start)/.32,0,1):1,shift=motion?(1-(1-(1-p)**3))*unit*.06:0;
  ctx.save();ctx.translate(w*.5,h*.47+shift);if(look==='kinetic'&&motion)ctx.rotate(-.025+Math.sin(index)*.018);
  const lh=fit.size*1.17;ctx.textAlign=look==='paper'?'left':'center';
  fit.lines.forEach((line,i)=>{const y=(i-(fit.lines.length-1)/2)*lh,x=look==='paper'?-w*.39:0;
    if(look==='echo'){for(let z=5;z>=1;z--){ctx.strokeStyle=accent;ctx.globalAlpha=.035*(6-z);ctx.lineWidth=1;ctx.strokeText(line,x,y+z*unit*(.026+a*.009));}ctx.globalAlpha=1;}
    if(look==='architecture'){ctx.fillStyle='#193746';for(let z=12;z>0;z-=2)ctx.fillText(line,x+z,y+z);}
    ctx.fillStyle=look==='kinetic'&&i%2===1?accent:fg;ctx.fillText(line,x,y);
  });ctx.restore();
  if(cue){ctx.fillStyle=look==='paper'?'#d9cbbb':'#ffffff22';ctx.fillRect(w*.1,h*.8,w*.8,3);ctx.fillStyle=accent;ctx.fillRect(w*.1,h*.8,w*.8*clamp((t-cue.start)/(cue.end-cue.start),0,1),3);}
  ctx.textAlign='left';ctx.fillStyle=look==='paper'?'#796b59':'#aca4b0';ctx.font=`500 ${unit*.019}px "Instrument Sans", sans-serif`;ctx.fillText(title.slice(0,50),w*.1,h*.91);
  ctx.textAlign='right';ctx.fillText(cue?`${String(index+1).padStart(2,'0')} / ${String(cues.length).padStart(2,'0')}`:'',w*.9,h*.91);
}
