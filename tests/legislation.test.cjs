const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness(){
  const elements=new Map(),errors=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{disabled:false,innerHTML:'',textContent:'',addEventListener(){},appendChild(){},scrollIntoView(){}});return elements.get(id);};
  const ctx=vm.createContext({document:{createElement:()=>element(Math.random()),querySelector:()=>element('main'),querySelectorAll:()=>[],getElementById:element},auth:null,goTo(){},showToast:x=>errors.push(x),isAdmin:true,currentUser:{uid:'admin'},chatHistory:[],DB_PATH:'test',URL,console,setTimeout,escHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../legislation.js'),'utf8'),ctx);
  return {ctx,errors,element,run:s=>vm.runInContext(s,ctx)};
}
test('comparison preserves duplicate counts and escapes document HTML',()=>{
  const h=harness();const result=h.run('diffParagraphs("Igual. Igual. <script>x</script>", "Igual. Nuevo.")');
  assert.match(result[0],/<mark>Igual\.<\/mark>/);assert.match(result[0],/&lt;script&gt;/);assert.match(result[1],/<mark>Nuevo\.<\/mark>/);assert.ok(!result[0].includes('<script>'));
});
test('multimodal request carries real image bytes before the question',()=>{
  const h=harness();const out=h.run('assistantImages=[{url:"data:image/png;base64,YWJj",type:"image/png"}]; assistantMessageContent("Explica")');
  assert.equal(out[0].source.data,'YWJj');assert.equal(out[0].source.media_type,'image/png');assert.equal(out[1].text,'Explica');
});
test('a modification document cannot become the reference version',async()=>{
  const h=harness();h.run('lawVersions={v:{tipo:"modificacion"}}');h.ctx.db={ref(){throw Error('Must not write');}};
  await h.run('approveLawVersion("v", {disabled:false})');
});
test('approval rejects concurrent changes instead of overwriting them',async()=>{
  const h=harness();h.run('selectedLawId="law";laws=[{id:"law",versionActual:"old"}];lawVersions={v:{tipo:"completo"}}');
  h.ctx.db={ref:()=>({transaction:async f=>({committed:f({versionActual:'changed'})!==undefined})})};
  await h.run('approveLawVersion("v", {disabled:false})');
  assert.match(h.errors[0],/Otra sesión/);
});
test('approval keeps past approvals and records the actor',async()=>{
  const h=harness();let saved;
  h.run('selectedLawId="law";laws=[{id:"law",versionActual:"old"}];lawVersions={v:{tipo:"completo"}};openLaw=async()=>{}');
  h.ctx.db={ref:()=>({transaction:async f=>{saved=f({versionActual:'old',aprobaciones:{old:{por:'original'}}});return {committed:true};}})};
  await h.run('approveLawVersion("v", {disabled:false})');assert.equal(saved.versionActual,'v');assert.equal(saved.aprobaciones.old.por,'original');assert.equal(saved.aprobaciones.v.por,'admin');
});
test('law context includes the exact version and every supplied page',async()=>{
  const h=harness();h.run('assistantLaw={id:"law",version:"v2",nombre:"Norma de prueba"}');
  h.ctx.db={ref:()=>({once:async()=>({val:()=>({texto:{0:'Primera',8:'Última'},tipo:'completo',archivo:'norma.pdf',fuente:'https://example.org',publicacion:'2026-01-01',vigencia:'2026-02-01'})})})};
  const text=await h.run('getAssistantLawContext()');assert.match(text,/Versión: v2/);assert.match(text,/PÁGINA 9/);assert.match(text,/Última/);
});
test('reset clears law context, image data and conversation together',()=>{
  const h=harness();h.run('assistantLaw={id:"a"};assistantImages=[{}];chatHistory=[{}];resetAssistant()');assert.equal(h.run('assistantLaw'),null);assert.equal(h.run('assistantImages.length+chatHistory.length'),0);
});
test('document retrieval reaches relevant pages beyond the original prefix limit',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const fn=source.slice(source.indexOf('async function buildContext('),source.indexOf('// Convierte citas'));
  const ctx=vm.createContext({allPdfs:[{id:'doc',nombre:'Manual',paginas:20}],_leerTextoCompleto:async()=>({0:'Introducción '.repeat(6000),19:'El procedimiento de apelación establece un plazo de quince días.'})});
  vm.runInContext(fn,ctx);
  const answer=await vm.runInContext('buildContext(["doc"], "apelación")',ctx);
  assert.match(answer,/PÁGINA 20/);assert.match(answer,/quince días/);assert.match(answer,/Fragmentos seleccionados/);assert.ok(answer.length<49000);
});
