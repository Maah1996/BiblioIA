const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const ctx=vm.createContext({katex:require(path.join(root,'vendor/katex/katex.min.js')),_linkificarCitas:s=>s});
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
vm.runInContext(app.slice(app.indexOf('function _esFilaSeparadoraTabla('),app.indexOf('// Para meter un valor dentro de onclick')),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'response-renderer.js'),'utf8'),ctx);
function render(text){ctx.input=text;return vm.runInContext('formatAIResponse(input)',ctx);}
const example=String.raw`$$\frac{\sqrt{27}+\sqrt{75}}{\sqrt{48}}$$
### Paso 1: Descomponer las raíces
Extraemos los cuadrados perfectos.
$$\sqrt{27}=\sqrt{9\cdot3}=3\sqrt3$$
$$\sqrt{75}=\sqrt{25\cdot3}=5\sqrt3$$
$$\sqrt{48}=\sqrt{16\cdot3}=4\sqrt3$$
### Paso 2: Sumar el numerador
$$3\sqrt3+5\sqrt3=(3+5)\sqrt3=8\sqrt3$$
### Paso 3: Dividir y cancelar
$$\frac{8\sqrt3}{4\sqrt3}=\frac84=2$$
### Resultado final
$$\boxed{2}$$`;
test('the supplied exercise renders as three step cards and a result with real fractions',()=>{
  const html=render(example);assert.equal((html.match(/class="solution-step/g)||[]).length,4);assert.match(html,/solution-result/);assert.match(html,/<math/);assert.match(html,/<mfrac>/);assert.match(html,/<msqrt>/);assert.ok(!html.includes('$$'));assert.ok(!html.includes('###'));
});
test('inline, display and multiline delimiters render consistently',()=>{
  const html=render(String.raw`**Raíz:** $\sqrt{3}$, \(x^2\).
\[
\frac{1}{2}
\]`);assert.match(html,/<strong>Raíz:<\/strong>/);assert.equal((html.match(/<math/g)||[]).length,3);
});
test('tables keep their structure and render embedded mathematics',()=>{
  const html=render('| Valor | Raíz |\n| --- | --- |\n| 27 | $\\sqrt{27}$ |');assert.match(html,/<table/);assert.match(html,/<msqrt>/);
});
test('model HTML and unsafe TeX links are not executable',()=>{
  const html=render(String.raw`<img src=x onerror=alert(1)> $\href{javascript:alert(1)}{clic}$`);assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/&lt;img/);
});
test('invalid or unfinished formulas do not break a streamed response',()=>{
  assert.doesNotThrow(()=>render(String.raw`### Paso 1: Desarrollo
$$\frac{`));assert.match(render('$$\\unknowncommand{a}$$'),/formula-fallback/);
});
module.exports={example};
