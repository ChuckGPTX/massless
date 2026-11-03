import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanCues,parseLyrics,fromTranscript,cueAt,cropScore,toSrt,toLrc,analyzeBands,drawLyrics,LOOKS} from '../public/js/lyrics-engine.js';

test('timed lyrics retain real gaps, Unicode and chorus emphasis',()=>{
  const srt='1\n00:00:01,250 --> 00:00:03,500\n夜空の声 🌙\n\n2\n00:00:05,000 --> 00:00:06,750\nSecond phrase';
  const result=parseLyrics(srt,10);assert.equal(result.estimated,false);assert.equal(result.cues[0].text,'夜空の声 🌙');assert.equal(cueAt(result.cues,4),-1);
  assert.deepEqual(parseLyrics(toSrt(result.cues),10).cues,result.cues);
  assert.equal(cleanCues([{start:1,end:3,text:'Chorus',emphasis:true}],4)[0].emphasis,true);
});
test('LRC supports repeat timestamps and full precision without invalid seconds',()=>{
  const r=parseLyrics('[00:01.25][00:06.50]Repeat me\n[00:09.00]Last line',12);
  assert.deepEqual(r.cues.map(c=>c.start),[1.25,6.5,9]);assert.equal(r.estimated,false);
  assert.match(toLrc([{start:59.999,text:'Turn'}]),/\[01:00.00\]/);
});
test('plain text explicitly reports estimated timing and handles empty input',()=>{
  const r=parseLyrics('First\n\nSecond',8);assert.equal(r.estimated,true);assert.deepEqual(r.cues.map(c=>[c.start,c.end]),[[0,4],[4,8]]);
  assert.deepEqual(parseLyrics('',8).cues,[]);
});
test('bad timings are discarded, overlaps clipped, and boundaries stay in the song',()=>{
  const r=cleanCues([{start:8,end:20,text:'last'},{start:-1,end:5,text:'first'},{start:3,end:7,text:'second'},{start:'bad',end:5,text:'invalid'},{start:2,end:2,text:'empty'}],10);
  assert.deepEqual(r.map(c=>[c.start,c.end]),[[0,3],[3,7],[8,10]]);
  assert.equal(cueAt(r,3),1);assert.equal(cueAt(r,10),-1);
});
test('transcript phrase breaks use provided word times when present',()=>{
  const words=Array.from({length:8},(_,i)=>({word:'word'+i,start:i,end:i+.5}));
  const r=fromTranscript([{start:0,end:8,text:words.map(w=>w.word).join(' '),words}],9);
  // 48 characters is too long for one line: split into balanced halves, never 7 + an orphan.
  assert.equal(r.length,2);assert.equal(r[0].words.length,4);assert.equal(r[1].start,4);assert.equal(r[0].end,4);
});
test('audio crop preserves exact stereo samples for the selected excerpt',()=>{
  const r=cropScore({sampleRate:10,channels:[Float32Array.from({length:50},(_,i)=>i),Float32Array.from({length:50},(_,i)=>-i)]},1.2,2);
  assert.equal(r.channels[0].length,20);assert.equal(r.channels[0][0],12);assert.equal(r.channels[1][19],-31);
});
test('silence is finite and frequency bands distinguish a low tone',()=>{
  const silence=analyzeBands([new Float32Array(16000)],16000);assert(silence.bands.every(b=>b.every(x=>x===0)));
  const tone=Float32Array.from({length:16000},(_,i)=>Math.sin(i/16000*2*Math.PI*90));const r=analyzeBands([tone],16000);
  assert.equal(r.bands[0].length,50);assert(r.bands.every(b=>b.every(x=>Number.isFinite(x)&&x>=0&&x<=1)));
});
test('all visual styles render with long unbroken words and lyric-free gaps',()=>{
  const drawn=[];let font='';
  const ctx=new Proxy({set font(x){font=x;},get font(){return font;},measureText:s=>({width:s.length*(parseFloat(font.match(/([\d.]+)px/)?.[1])||12)*.6}),fillText:(text,x,y)=>{assert(Number.isFinite(x)&&Number.isFinite(y));drawn.push(text);},createRadialGradient:()=>({addColorStop(){}})}, {get:(o,k)=>k in o?o[k]:()=>{}});
  const canvas={width:720,height:1280,getContext:()=>ctx};
  for(const item of LOOKS)drawLyrics(canvas,2,{look:item.id,cues:[{start:1,end:4,text:'a'.repeat(500),emphasis:true}],title:'Test'});
  drawn.length=0;drawLyrics(canvas,5,{cues:[{start:0,end:3,text:'Already finished'}],title:'Test'});assert(!drawn.includes('ALREADY FINISHED'));assert(!drawn.includes('INSTRUMENTAL'));
});
