import { TEMPLATES_LIST } from '../website/templates-list.js';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
function render(){
 const q=$('template-search').value.trim().toLowerCase();
 const list=TEMPLATES_LIST.filter(t=>[t.title,t.description,t.kind,t.motionLabel||'motion'].join(' ').toLowerCase().includes(q));
 $('template-catalog').replaceChildren(...list.map(t=>{
  const card=node('article',null,'console-card'),preview=node('a'),img=node('img');preview.href=t.href;
  img.src=t.thumb;img.alt=t.title+' website preview';img.loading='lazy';img.width=640;img.height=400;preview.append(img);
  const links=node('div',null,'console-card-links'),customize=node('a','Customize this design ↗');customize.href=t.href;links.append(customize);
  card.append(preview,node('h3',t.title),node('p',t.description),node('small',t.motionLabel||'Reveal and scroll motion'),links);return card;
 }));
 $('result-count').textContent=`${list.length} of ${TEMPLATES_LIST.length} designs`;$('empty-result').hidden=!!list.length;
}
$('template-search').addEventListener('input',render);render();
