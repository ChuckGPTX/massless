import test from 'node:test';
import assert from 'node:assert/strict';
import {generateLyricVideo,directLyrics} from '../public/js/lyric-generation.js';

test('one upload produces a completed video only after its lyrics and design are ready',async()=>{
 const events=[];let ready;const hold=new Promise(resolve=>ready=resolve);let words=false;
 const run=generateLyricVideo({prepare:async()=>events.push('audio'),transcribe:async()=>{await hold;words=true;events.push('words');},compose:()=>{assert.ok(words);events.push('design');},render:async(signal,progress)=>{events.push('render');progress(.5);return new Blob(['movie']);},onStage:(name,p)=>{if(p===.5)events.push('half');}});
 await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(events,['audio']);ready();
 const video=await run;assert.equal(await video.text(),'movie');assert.deepEqual(events,['audio','words','design','render','half']);
});
test('a transcription failure never presents a finished video',async()=>{
 let rendered=false;
 await assert.rejects(generateLyricVideo({transcribe:async()=>{throw new Error('No words found');},render:async()=>{rendered=true;}}),/No words/);assert.equal(rendered,false);
});
test('retrying an export can reuse lyrics without calling transcription again',async()=>{
 let charged=0,attempt=0;const transcribe=async()=>{charged++;};const render=async()=>{if(!attempt++)throw new Error('encoder');return 'movie';};
 await assert.rejects(generateLyricVideo({transcribe,render}),/encoder/);
 assert.equal(await generateLyricVideo({render}),'movie');assert.equal(charged,1);
});
test('cancel during a pending transcript prevents composition and rendering',async()=>{
 const controller=new AbortController();let rendered=false;
 await assert.rejects(generateLyricVideo({signal:controller.signal,transcribe:async()=>controller.abort(),compose:()=>assert.fail('must not compose'),render:async()=>{rendered=true;}}),{name:'AbortError'});assert.equal(rendered,false);
});
test('cancel before encoder completion prevents publishing its late result',async()=>{
 const controller=new AbortController();await assert.rejects(generateLyricVideo({signal:controller.signal,render:async()=>{controller.abort();return 'late movie';}}),{name:'AbortError'});
});
test('repeated phrase emphasis preserves timing and existing artistic decisions',()=>{
 const input=[{text:'Carry it home!',start:0,end:2},{text:'A quiet verse',start:3,end:5,emphasis:true},{text:'Carry it home',start:6,end:8},{text:'Oh',start:9,end:10},{text:'Oh',start:11,end:12}];
 const output=directLyrics(input);assert.deepEqual(output.map(x=>x.emphasis),[true,true,true,false,false]);assert.deepEqual(output.map(x=>[x.start,x.end]),input.map(x=>[x.start,x.end]));assert.equal(input[0].emphasis,undefined);
});
