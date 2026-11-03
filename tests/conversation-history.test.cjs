const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function setup(){
 class Element{constructor(){this.children=[];this.dataset={};this.value='';}appendChild(x){if(x.parent)x.parent.children=x.parent.children.filter(y=>y!==x);this.children.push(x);x.parent=this;return x;}prepend(x){this.appendChild(x);this.children.pop();this.children.unshift(x);}replaceChildren(){this.children.forEach(x=>x.parent=null);this.children=[];}}
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const ctx=vm.createContext({document:{getElementById:el,createElement:()=>new Element()},currentUser:{uid:'u'},DB_PATH:'app',auth:null,formatAIResponse:s=>s,showToast(){},console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../conversation-history.js'),'utf8'),ctx);
 return {ctx,el,run:s=>vm.runInContext(s,ctx)};
}
test('saved entries load newest first and survive reopening without duplication',async()=>{
 const h=setup();h.ctx.db={ref:()=>({once:async()=>({val:()=>({old:{pregunta:'Antes',respuesta:'A',fecha:'2026-01-01'},new:{pregunta:'Después',respuesta:'B',fecha:'2026-02-01'}})})})};
 await h.run('loadAssistantArchive()');await h.run('loadAssistantArchive()');assert.deepEqual(h.el('chat-messages').children.map(x=>x.dataset.queryId),['new','old']);
});
test('search covers answers, questions and source names without accents',()=>{
 const h=setup();assert.equal(h.run('archiveMatches({pregunta:"Matemáticas",respuesta:"raíz",pdfs:["Guía"]},"matematicas")'),true);assert.equal(h.run('archiveMatches({respuesta:"raíz"},"raiz")'),true);assert.equal(h.run('archiveMatches({pdfs:["Guía"]},"guia")'),true);assert.equal(h.run('archiveMatches({ley:{nombre:"Norma 44"}},"44")'),true);
});
test('a new question stays grouped above old queries while filtering hides only unmatched entries',()=>{
 const h=setup();h.run('insertArchiveEntry("old",{pregunta:"Historia",respuesta:"Roma",fecha:"2026-01-01"});beginAssistantEntry("new",{pregunta:"Álgebra",fecha:"2026-02-01"});finishAssistantEntry();filterAssistantArchive("algebra")');
 const entries=h.el('chat-messages').children;assert.equal(entries[0].dataset.queryId,'new');assert.equal(entries[0].hidden,false);assert.equal(entries[1].hidden,true);
});
test('late history responses cannot leak across sign-outs',async()=>{
 const h=setup();let resolve;h.ctx.db={ref:()=>({once:()=>new Promise(r=>resolve=r)})};const pending=h.run('loadAssistantArchive()');h.run('currentUser=null;clearAssistantArchive()');resolve({val:()=>({private:{pregunta:'Privado',fecha:'2026-01-01'}})});await pending;assert.equal(h.el('chat-messages').children.length,0);
});
test('a history load does not overwrite a question started while loading',async()=>{
 const h=setup();let resolve;h.ctx.db={ref:()=>({once:()=>new Promise(r=>resolve=r)})};const pending=h.run('loadAssistantArchive()');h.run('beginAssistantEntry("new",{pregunta:"Ahora",fecha:"2026-03-01"})');resolve({val:()=>({old:{pregunta:'Antes',fecha:'2026-01-01'}})});await pending;assert.deepEqual(h.el('chat-messages').children.map(x=>x.dataset.queryId),['new','old']);
});
