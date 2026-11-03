import test from 'node:test';
import assert from 'node:assert/strict';
import {dropInvented,wordsFrom,phraseCues,alignLyrics,lyricLines,promptFrom} from '../public/js/lyric-align.js';
import {drawLyrics} from '../public/js/lyrics-engine.js';

const seg=(start,end,text,extra={})=>{const t=text.split(' ');const step=(end-start)/t.length;return{start,end,text,words:t.map((w,i)=>({word:' '+w,start:start+i*step,end:start+(i+.9)*step})),avg_logprob:-.4,no_speech_prob:.2,...extra};};

test('invented outro phrases and looping text over music are dropped',()=>{
  const kept=dropInvented([seg(0,3,'Drop your song in'),{start:26,end:48,text:'Thank you for watching.'},{start:30,end:33,text:"I'll see you next time.",no_speech_prob:.8,avg_logprob:-1.1},{start:40,end:44,text:'la la la la la la la la',compression_ratio:3.1},{start:10,end:32,text:'I love you'}]);
  assert.deepEqual(kept.map(s=>s.text),['Drop your song in']);
});
test('a stretched last word cannot hold the screen through an instrumental',()=>{
  // Right after a sung line (so not an isolated invention): kept, but only held briefly.
  const w=wordsFrom([seg(23,26,'ready to'),{start:26,end:48,text:'go',words:[{word:'go',start:26,end:48}]}]);
  assert.equal(w.at(-1).text,'go');assert.ok(w.at(-1).end<=28.5);
  // The same stretched word alone in an instrumental is dropped.
  assert.equal(wordsFrom([{start:30,end:48,text:'go',words:[{word:'go',start:30,end:48}]}]).length,0);
});
test('each Whisper phrase is one line; long ones split evenly at a comma',()=>{
  const c=phraseCues([seg(0,3,'Every word you sing is ready to go'),seg(3,6,'Chopped and signed, mixed with lyrics and something extra')]);
  assert.equal(c[0].text,'Every word you sing is ready to go');
  assert.equal(c.length,3);assert.equal(c[1].text,'Chopped and signed,');assert.ok(c.every(x=>x.words.length>=2));
});
test('typed lyrics keep heard timing even where Whisper misheard words',()=>{
  const heard=wordsFrom([seg(1.8,4.9,'Draw your song and hear it blow'),seg(4.9,9.4,'Every word you sing is ready to go'),seg(24,26,'Chug this time as the lyrics breezy')]);
  const r=alignLyrics('[Verse]\nDrop your song in, hit upload\nEvery word you sing is ready to go\n\n[Chorus]\nChuck S.I. makes the lyrics breezy',heard,48);
  assert.deepEqual(r.cues.map(c=>c.text),['Drop your song in, hit upload','Every word you sing is ready to go','Chuck S.I. makes the lyrics breezy']);
  assert.ok(r.cues[0].start>=1.7&&r.cues[0].start<2);assert.ok(r.cues[1].start>=4.8&&r.cues[1].start<5);assert.ok(r.cues[2].start>=23.9&&r.cues[2].start<24.5);
  assert.ok(r.matched>.6);
  for(const c of r.cues){assert.equal(c.words.length,c.text.split(' ').length);for(let i=1;i<c.words.length;i++)assert.ok(c.words[i].start>=c.words[i-1].start);}
  for(let i=1;i<r.cues.length;i++)assert.ok(r.cues[i].start>=r.cues[i-1].end-1e-9);
});
test('section labels are not lyrics and the prompt stays within 240 characters',()=>{
  assert.deepEqual(lyricLines('[Chorus]\nHello there (x2)\nVerse 2:\nBye'),['Hello there','Bye']);
  assert.ok(promptFrom('word '.repeat(200)).length<=240);
  assert.deepEqual(alignLyrics('anything',[],10).cues,[]);
});
test('words light up as they are sung',()=>{
  const fills=[];let font='',alpha=1;
  const ctx=new Proxy({set font(x){font=x;},get font(){return font;},set globalAlpha(a){alpha=a;},get globalAlpha(){return alpha;},measureText:s=>({width:s.length*10}),fillText:(text)=>fills.push([text,alpha]),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
  const canvas={width:1280,height:720,getContext:()=>ctx};
  drawLyrics(canvas,1.5,{look:'paper',cues:[{start:0,end:3,text:'one two three',words:[{text:'one',start:0,end:1},{text:'two',start:1,end:2},{text:'three',start:2,end:3}]}],title:''});
  const words=fills.filter(f=>['one','two','three'].includes(f[0]));
  assert.deepEqual(words.map(f=>f[1]),[1,1,.34]);
});
import {analyzeBands,estimateBeat} from '../public/js/lyrics-engine.js';
test('tempo and beat phase come from the audio itself',()=>{
  const rate=16000,secs=20,x=new Float32Array(rate*secs),period=60/100;
  for(let b=0.25;b<secs;b+=period)for(let i=0;i<800;i++){const k=Math.round(b*rate)+i;if(k<x.length)x[k]+=Math.sin(i/rate*2*Math.PI*80)*Math.exp(-i/300);}
  const beat=estimateBeat(analyzeBands([x],rate));
  assert.ok(Math.abs(beat.bpm-100)<1.5,`bpm ${beat.bpm}`);
  const off=((beat.offset-0.25)%period+period)%period;assert.ok(off<.06||off>period-.06,`offset ${beat.offset}`);
  assert.equal(estimateBeat(analyzeBands([new Float32Array(rate)],rate)),null);
});
