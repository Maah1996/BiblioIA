// ╔══════════════════════════════════════════════════════════╗
// ║  CONFIGURACIÓN — Modifica estos valores antes de usar   ║
// ╚══════════════════════════════════════════════════════════╝
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyA-uCb3WFck_bzOOEka0ZRfRyUOEOI3V8g",
  authDomain:        "maahia.firebaseapp.com",
  databaseURL:       "https://maahia-default-rtdb.firebaseio.com",
  projectId:         "maahia",
  storageBucket:     "maahia.firebasestorage.app",
  messagingSenderId: "242315685393",
  appId:             "1:242315685393:web:ac8c7a32eb88caeed68bb0"
};
let CLAUDE_API_KEY = ""; // Se carga desde Firebase al iniciar sesión como admin
const ADMIN_EMAIL    = "marcoaraya1973@gmail.com";        // Email del administrador
const DB_PATH        = "biblioteca_maah";                 // Ruta raíz en Firebase

// ── Firebase init ─────────────────────────────────────────
let db, auth, storage, currentUser = null, isAdmin = false;
let allPdfs = [];
let allAudios = [];
let userCarpetasPermitidas = null; // null = acceso total; array de IDs = solo esas carpetas

try {
  firebase.initializeApp(FIREBASE_CONFIG);
  db      = firebase.database();
  auth    = firebase.auth();
  storage = firebase.storage();
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} catch(e) {
  console.warn('Firebase no configurado:', e.message);
}

// ── PDF.js worker ─────────────────────────────────────────
if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ══ AUTH ══════════════════════════════════════════════════
auth && auth.onAuthStateChanged(async user => {
  if(user){
    currentUser = user;
    isAdmin = user.email === ADMIN_EMAIL;
    await ensureUserRecord(user);
    showApp();
    await loadClaudeKey();
    loadAllData();
  } else {
    currentUser = null;
    showLanding();
  }
});

function openAuth(mode){ document.getElementById('modal-auth').classList.add('open'); toggleAuth(mode); }
function closeAuth(){ document.getElementById('modal-auth').classList.remove('open'); }
function toggleAuth(mode){
  document.getElementById('form-login').style.display    = mode==='login'    ? '' : 'none';
  document.getElementById('form-register').style.display = mode==='register' ? '' : 'none';
}

async function doLogin(){
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('btn-login');
  errEl.classList.remove('show');
  if(!email||!pass){ showErr(errEl,'Completa todos los campos.'); return; }
  btn.disabled=true; btn.textContent='Ingresando...';
  try {
    await auth.signInWithEmailAndPassword(email, pass);
    closeAuth();
  } catch(e) {
    showErr(errEl, mapAuthError(e.code));
  } finally { btn.disabled=false; btn.textContent='Iniciar sesión'; }
}

async function doRegister(){
  const nombre = document.getElementById('reg-nombre').value.trim();
  const email  = document.getElementById('reg-email').value.trim();
  const pass   = document.getElementById('reg-pass').value;
  const errEl  = document.getElementById('reg-error');
  const btn    = document.getElementById('btn-register');
  errEl.classList.remove('show');
  if(!nombre||!email||!pass){ showErr(errEl,'Completa todos los campos.'); return; }
  if(pass.length < 6){ showErr(errEl,'La contraseña debe tener al menos 6 caracteres.'); return; }
  btn.disabled=true; btn.textContent='Creando cuenta...';
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await ensureUserRecord(cred.user, nombre);
    closeAuth();
    showToast('Cuenta creada. Bienvenido/a 🎉');
  } catch(e) {
    showErr(errEl, mapAuthError(e.code));
  } finally { btn.disabled=false; btn.textContent='Crear cuenta'; }
}

function doLogout(){ auth.signOut(); }

// ══ PREVIEW MODE ══════════════════════════════════════════
function entrarPreview(){
  document.getElementById('preview-bar').style.display='flex';
  document.getElementById('app').classList.add('preview-mode');
  document.getElementById('nav-admin').style.display='none';
  goTo('biblioteca-user');
}
function salirPreview(){
  document.getElementById('preview-bar').style.display='none';
  document.getElementById('app').classList.remove('preview-mode');
  document.getElementById('nav-admin').style.display='';
  goTo('dashboard');
}

function loadAjustes(){
  const statusEl = document.getElementById('key-loaded-status');
  if(CLAUDE_API_KEY) {
    statusEl.textContent = '✅ Clave cargada y activa — la IA puede responder consultas.';
    statusEl.style.color = 'var(--green)';
  } else {
    statusEl.textContent = '⚠️ No hay clave configurada — ingresa tu API Key de Claude arriba.';
    statusEl.style.color = 'var(--red)';
  }
}

async function saveClaudeKey(){
  const key = document.getElementById('claude-key-input').value.trim();
  const statusEl = document.getElementById('key-status');
  if(!key.startsWith('sk-ant-')){ showToast('La clave debe empezar con sk-ant-','red'); return; }
  try {
    await db.ref(`${DB_PATH}/config/claudeKey`).set(key);
    CLAUDE_API_KEY = key;
    statusEl.textContent = '✅ Guardada';
    statusEl.style.color = 'var(--green)';
    document.getElementById('claude-key-input').value = '';
    document.getElementById('key-loaded-status').textContent = '✅ Clave cargada y activa — la IA puede responder consultas.';
    document.getElementById('key-loaded-status').style.color = 'var(--green)';
    showToast('Clave API guardada correctamente ✓','green');
  } catch(e){ showToast('Error al guardar: '+e.message,'red'); }
}

async function loadClaudeKey(){
  try {
    const snap = await db.ref(`${DB_PATH}/config/claudeKey`).once('value');
    if(snap.val()) CLAUDE_API_KEY = snap.val();
  } catch(e){ console.warn('No se pudo cargar Claude key:', e); }
}

async function ensureUserRecord(user, nombre=''){
  const snap = await db.ref(`${DB_PATH}/usuarios/${user.uid}`).once('value');
  if(!snap.exists()){
    await db.ref(`${DB_PATH}/usuarios/${user.uid}`).set({
      nombre: nombre || user.displayName || user.email.split('@')[0],
      email: user.email,
      plan: 'inactivo',
      rol: user.email === ADMIN_EMAIL ? 'admin' : 'usuario',
      fechaRegistro: new Date().toISOString(),
      consultas: 0
    });
  }
}

function mapAuthError(code){
  const m = { 'auth/invalid-email':'Email inválido.','auth/user-not-found':'Usuario no encontrado.','auth/wrong-password':'Contraseña incorrecta.','auth/email-already-in-use':'Ese email ya está registrado.','auth/weak-password':'Contraseña muy débil.' };
  return m[code] || 'Error al autenticar. Intenta nuevamente.';
}
function showErr(el, msg){ el.textContent=msg; el.classList.add('show'); }

// ══ NAVIGATION ════════════════════════════════════════════
function showLanding(){
  document.getElementById('landing').style.display='block';
  document.getElementById('app').style.display='none';
}
function showApp(){
  document.getElementById('landing').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('nav-admin').style.display = isAdmin ? '' : 'none';
  document.getElementById('top-badge').textContent = isAdmin ? 'Admin' : 'Miembro';
  document.getElementById('top-badge').className = isAdmin ? 'top-badge admin' : 'top-badge';
  db.ref(`${DB_PATH}/usuarios/${currentUser.uid}`).once('value').then(snap=>{
    const u = snap.val()||{};
    document.getElementById('top-name').textContent = u.nombre || currentUser.email;
    // Cargar permisos de carpetas (null = acceso total)
    userCarpetasPermitidas = u.carpetasPermitidas || null;
  });
  if(isAdmin) goTo('dashboard'); else goTo('biblioteca-user');
}

function goTo(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if(el) el.classList.add('active');
  document.querySelectorAll(`.nav-item[data-view="${view}"]`).forEach(n=>n.classList.add('active'));
  if(view==='biblioteca-admin') loadAdminPdfs();
  if(view==='usuarios') loadUsers();
  if(view==='biblioteca-user') loadUserLibrary();
  if(view==='consultar') loadPdfSelector();
  if(view==='historial') loadHistorial();
  if(view==='perfil') loadPerfil();
  if(view==='dashboard') loadDashboard();
  if(view==='ajustes') loadAjustes();
  if(view==='materias') loadMaterias();
  if(view==='audios-admin') loadAdminAudios();
  if(view==='cuestionario') loadCuestionario();
  if(view==='banco-preguntas') initBancoPreguntas();
}

// ══ LOAD ALL DATA ═════════════════════════════════════════
// Cuando llegan datos nuevos de Firebase, redibuja la pantalla activa si depende
// de esos datos. Arregla la "carrera": antes la vista se pintaba antes de que
// llegaran los datos y quedaba vacia; ahora se actualiza sola cuando llegan (y
// tambien queda en vivo: si se sube o borra algo, la lista se refresca sola).
function refrescarVistaActiva(){
  const activa = document.querySelector('.view.active');
  if(!activa) return;
  const view = activa.id.replace(/^view-/, '');
  if(view==='biblioteca-admin') loadAdminPdfs();
  else if(view==='materias') loadMaterias();
  else if(view==='consultar') loadPdfSelector();
  else if(view==='biblioteca-user'){
    if(currentMateria){
      renderLibraryGrid(allPdfs.filter(p=>p.categoria===currentMateria));
      renderAudioGrid(currentMateria);
    } else if(document.getElementById('lib-carpetas-view')?.style.display!=='none'){
      renderCarpetas();
    }
  }
}

function loadAllData(){
  db.ref(`${DB_PATH}/pdfs`).on('value', snap=>{
    allPdfs = [];
    const data = snap.val()||{};
    Object.entries(data).forEach(([id,p])=>{ if(p) allPdfs.push({id,...p}); });
    allPdfs.sort((a,b)=>new Date(b.fechaSubida||0)-new Date(a.fechaSubida||0));
    refrescarVistaActiva();
  });
  db.ref(`${DB_PATH}/audios`).on('value', snap=>{
    allAudios = [];
    const data = snap.val()||{};
    Object.entries(data).forEach(([id,a])=>{ if(a) allAudios.push({id,...a}); });
    allAudios.sort((a,b)=>new Date(b.fechaSubida||0)-new Date(a.fechaSubida||0));
    refrescarVistaActiva();
  });
  loadAllMaterias();
}

// ══ DASHBOARD ═════════════════════════════════════════════
function loadDashboard(){
  db.ref(`${DB_PATH}/pdfs`).once('value', s=>{
    const pdfs = s.val()||{};
    document.getElementById('stat-pdfs').textContent = Object.keys(pdfs).length;
  });
  db.ref(`${DB_PATH}/usuarios`).once('value', s=>{
    const users = s.val()||{};
    document.getElementById('stat-users').textContent = Object.keys(users).length;
    document.getElementById('stat-active').textContent = Object.values(users).filter(u=>u&&(u.plan==='activo'||u.rol==='admin')).length;
  });
  db.ref(`${DB_PATH}/consultas`).once('value', s=>{
    const qs = s.val()||{};
    let total = 0;
    Object.values(qs).forEach(userQs=>{ if(userQs) total += Object.keys(userQs).length; });
    document.getElementById('stat-queries').textContent = total;
    // Last queries
    const lastQs = [];
    Object.entries(qs).forEach(([uid,userQs])=>{
      if(userQs) Object.entries(userQs).forEach(([qid,q])=>{ if(q) lastQs.push(q); });
    });
    lastQs.sort((a,b)=>new Date(b.fecha||0)-new Date(a.fecha||0));
    const el = document.getElementById('dash-last-queries');
    if(!lastQs.length){ el.innerHTML='<p style="font-size:13px;color:var(--text-g);">Sin consultas aún</p>'; return; }
    el.innerHTML = lastQs.slice(0,4).map(q=>`
      <div style="padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="font-size:12px;font-weight:600;color:var(--navy);margin-bottom:2px;">${escHtml((q.pregunta||'').slice(0,70))}${(q.pregunta||'').length>70?'...':''}</div>
        <div style="font-size:11px;color:var(--text-g);">${fmtDate(q.fecha)}</div>
      </div>`).join('');
  });
}

// ══ PDF UPLOAD (multi-archivo) ════════════════════════════
let selectedFiles = []; // array de {file, nombre}

function handleFileSelect(e){ appendFiles(Array.from(e.target.files)); e.target.value=''; }
function handleDrop(e){
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  appendFiles(Array.from(e.dataTransfer.files));
}
function appendFiles(files){
  let agregados = 0;
  files.forEach(f=>{
    if(f.type !== 'application/pdf'){ showToast(`"${f.name}" no es PDF — ignorado.`,'red'); return; }
    if(f.size > 52428800){ showToast(`"${f.name}" supera 50 MB — ignorado.`,'red'); return; }
    // Evitar duplicados por nombre
    if(selectedFiles.find(x=>x.file.name===f.name && x.file.size===f.size)){ showToast(`"${f.name}" ya está en la cola.`,''); return; }
    selectedFiles.push({ file:f, nombre: f.name.replace(/\.pdf$/i,'') });
    agregados++;
  });
  if(agregados) renderFileList();
}
function renderFileList(){
  const el  = document.getElementById('upload-file-list');
  const bar = document.getElementById('upload-actions-bar');
  const zone = document.getElementById('upload-zone');
  const badge = document.getElementById('file-count-badge');
  if(!selectedFiles.length){
    el.style.display='none'; bar.style.display='none';
    zone.classList.remove('has-files');
    document.getElementById('uz-icon').textContent='📂';
    document.getElementById('uz-title').textContent='Arrastra tus PDFs aquí';
    document.getElementById('uz-sub').textContent='o haz clic para seleccionar · Puedes soltar varios a la vez · máx. 50 MB c/u';
    return;
  }
  zone.classList.add('has-files');
  document.getElementById('uz-icon').textContent='📋';
  document.getElementById('uz-title').textContent='Suelta más PDFs aquí para agregarlos';
  document.getElementById('uz-sub').textContent='Se añaden a la cola sin borrar los anteriores';
  badge.textContent = `${selectedFiles.length} PDF${selectedFiles.length!==1?'s':''} en cola`;
  el.style.display='flex';
  bar.style.display='flex';
  el.innerHTML = selectedFiles.map((item,i)=>`
    <div class="file-row" id="file-row-${i}">
      <span style="font-size:20px;flex-shrink:0;">📄</span>
      <input class="file-name-edit" id="fname-${i}" value="${escHtml(item.nombre)}" oninput="selectedFiles[${i}].nombre=this.value" title="Edita el nombre del documento">
      <span style="font-size:11px;color:var(--text-g);white-space:nowrap;flex-shrink:0;">${(item.file.size/1024/1024).toFixed(1)} MB</span>
      <span id="file-status-${i}" style="font-size:18px;flex-shrink:0;min-width:22px;text-align:center;">⏳</span>
      <button onclick="removeFile(${i})" style="background:none;border:none;font-size:15px;color:var(--text-g);cursor:pointer;padding:4px;flex-shrink:0;" title="Quitar">✕</button>
    </div>`).join('');
}
function removeFile(i){
  selectedFiles.splice(i,1);
  renderFileList();
}
function clearFile(){
  selectedFiles = [];
  renderFileList();
  const pw = document.getElementById('upload-progress-wrap');
  if(pw) pw.style.display='none';
  const pf = document.getElementById('progress-fill');
  if(pf) pf.style.width='0%';
  document.getElementById('file-input').value='';
  const ur = document.getElementById('upload-result');
  if(ur) ur.textContent='';
  document.getElementById('pdf-categoria').value='';
}

async function uploadPDF(){
  if(!selectedFiles.length){ showToast('Selecciona al menos un PDF.','red'); return; }
  const cat = document.getElementById('pdf-categoria').value;
  if(!cat){ showToast('Selecciona una materia/carpeta.','red'); return; }

  const btn = document.getElementById('btn-upload');
  btn.disabled=true; btn.textContent='Procesando...';
  document.getElementById('upload-progress-wrap').style.display='';
  document.getElementById('upload-result').textContent='';

  let ok=0, fail=0;
  for(let i=0; i<selectedFiles.length; i++){
    const item = selectedFiles[i];
    const nombre = item.nombre.trim() || item.file.name.replace(/\.pdf$/i,'');
    setFileStatus(i,'⏳');
    setProgress(0, `[${i+1}/${selectedFiles.length}] Leyendo "${nombre}"...`);
    try {
      const arrayBuffer = await item.file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;
      const textos = {};
      for(let p=1;p<=totalPages;p++){
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        textos[p-1] = content.items.map(s=>s.str).join(' ');
        setProgress(Math.round((p/totalPages)*85), `[${i+1}/${selectedFiles.length}] "${nombre}" — pág. ${p}/${totalPages}`);
      }
      setProgress(92, `[${i+1}/${selectedFiles.length}] Guardando "${nombre}"...`);
      const newRef = db.ref(`${DB_PATH}/pdfs`).push();
      await newRef.set({ id: newRef.key, nombre, categoria: cat, descripcion:'', paginas: totalPages, fechaSubida: new Date().toISOString(), subidoPor: currentUser.email, texto: textos });
      setFileStatus(i,'✅');
      ok++;
    } catch(e){
      console.error(e);
      setFileStatus(i,'❌');
      fail++;
    }
  }

  setProgress(100,'¡Completado!');
  const resEl = document.getElementById('upload-result');
  resEl.textContent = `✅ ${ok} subido${ok!==1?'s':''}${fail?` · ❌ ${fail} con error`:''}`;
  resEl.style.color = fail ? 'var(--red)' : 'var(--green)';
  showToast(`${ok} PDF${ok!==1?'s':''} subido${ok!==1?'s':''} correctamente ✓`,'green');
  btn.disabled=false; btn.textContent='⬆️ Procesar y subir';
  // Quitar de la cola los que subieron OK; dejar solo los fallidos
  if(!fail){ clearFile(); }
  else { selectedFiles = selectedFiles.filter((_,i)=>document.getElementById(`file-status-${i}`)?.textContent==='❌'); renderFileList(); }
}

function setFileStatus(i, icon){
  const el = document.getElementById(`file-status-${i}`);
  if(el) el.textContent=icon;
}

function setProgress(pct, label){
  document.getElementById('progress-fill').style.width=pct+'%';
  document.getElementById('progress-pct').textContent=pct+'%';
  document.getElementById('progress-label').textContent=label;
}

// ══ ADMIN LIBRARY ═════════════════════════════════════════
let _adminCarpetaActual = null; // id de la carpeta actual en el explorador de Documentos (null = raíz)

// Recorre las carpetas en orden de arbol (cada padre seguido de sus hijos, de
// forma recursiva) devolviendo {m, depth}. depth 0 = raiz. Soporta anidado
// ilimitado. El tope de profundidad es una guarda anti-bucle por si algun dia
// una carpeta quedara apuntando a un descendiente suyo.
function _materiasEnOrden(parentId=null, depth=0){
  const out=[];
  if(depth>20) return out;
  allMaterias.filter(m=>(m.parentId||null)===parentId).forEach(m=>{
    out.push({m, depth});
    out.push(..._materiasEnOrden(m.id, depth+1));
  });
  return out;
}

// Nombres de la carpeta "nombreCarpeta" + todas sus subcarpetas (a cualquier
// profundidad). Sirve para que filtrar por una carpeta padre tambien
// encuentre los documentos/audios archivados en sus subcarpetas — antes el
// filtro comparaba el nombre de forma exacta y una carpeta padre sin
// documentos propios mostraba "0" aunque sus hijas tuvieran material.
function _nombresConDescendientes(nombreCarpeta){
  const raiz = allMaterias.find(m=>m.nombre===nombreCarpeta);
  if(!raiz) return new Set([nombreCarpeta]);
  const nombres = new Set([raiz.nombre]);
  (function recorrer(id){
    allMaterias.filter(h=>h.parentId===id).forEach(h=>{ nombres.add(h.nombre); recorrer(h.id); });
  })(raiz.id);
  return nombres;
}

function _buildMateriaOpts(selected=''){
  // Opciones jerarquicas: arbol completo, indentado por nivel
  let opts = '<option value="">— Todas las carpetas —</option>';
  _materiasEnOrden().forEach(({m,depth})=>{
    const pad = '&nbsp;&nbsp;&nbsp;'.repeat(depth) + (depth>0?'↳ ':'');
    opts += `<option value="${escHtml(m.nombre)}" ${selected===m.nombre?'selected':''}>${pad}${escHtml(m.nombre)}</option>`;
  });
  return opts;
}

function loadAdminPdfs(){
  const count = document.getElementById('admin-pdf-count');
  if(count) count.textContent = allPdfs.length;
  _renderAdminExplorador();
}

// PDFs archivados DIRECTAMENTE en la carpeta "nombre" (sin contar los de sus
// subcarpetas). Si nombre es null (raíz), devuelve los huérfanos: pdfs cuya
// categoría no coincide con ninguna carpeta existente — así nunca desaparece
// un documento de la vista aunque su carpeta se haya borrado o renombrado.
function _pdfsDirectosDeCarpeta(nombre){
  if(nombre===null){
    const nombresConocidos = new Set(allMaterias.map(m=>m.nombre));
    return allPdfs.filter(p=>!nombresConocidos.has(p.categoria));
  }
  return allPdfs.filter(p=>p.categoria===nombre);
}

function _adminAbrirCarpeta(id){
  _adminCarpetaActual = id;
  _renderAdminExplorador();
}

function _adminVolverCarpeta(){
  const m = _adminCarpetaActual ? allMaterias.find(x=>x.id===_adminCarpetaActual) : null;
  _adminCarpetaActual = m ? (m.parentId||null) : null;
  _renderAdminExplorador();
}

function _adminBreadcrumbHtml(id){
  const ruta = _rutaMateria(id);
  let html = `<span onclick="_adminAbrirCarpeta(null)" style="cursor:pointer;font-weight:600;color:var(--blue);">📂 Documentos</span>`;
  ruta.forEach((m,i)=>{
    const esUltimo = i===ruta.length-1;
    html += ` <span style="color:var(--border);">/</span> `;
    html += esUltimo
      ? `<span style="color:var(--text-g);">${escHtml(m.nombre)}</span>`
      : `<span onclick="_adminAbrirCarpeta('${m.id}')" style="cursor:pointer;font-weight:600;color:var(--blue);">${escHtml(m.nombre)}</span>`;
  });
  return html;
}

function _adminCarpetaCard(m){
  const docsDirectos = _pdfsDirectosDeCarpeta(m.nombre).length;
  const hijos = allMaterias.filter(h=>h.parentId===m.id);
  const tieneHijos = hijos.length>0;
  const subInfo = tieneHijos
    ? `${hijos.length} subcarpeta${hijos.length!==1?'s':''}${docsDirectos?` · ${docsDirectos} doc.`:''}`
    : `${docsDirectos} documento${docsDirectos!==1?'s':''}`;
  return `<div onclick="_adminAbrirCarpeta('${m.id}')" style="cursor:pointer;background:var(--bg);border:2px solid var(--border);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;transition:border-color .15s;" onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border)'">
    <span style="width:44px;height:44px;border-radius:12px;background:#eff6ff;color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:22px;"><i class="ti ${tieneHijos?'ti-folders':'ti-folder'}"></i></span>
    <div style="font-size:13px;font-weight:600;color:var(--navy);word-break:break-word;">${escHtml(m.nombre)}</div>
    <div style="font-size:11px;color:var(--text-g);">${subInfo}</div>
  </div>`;
}

function _adminPdfTablaHtml(pdfs, dentroDeCarpeta){
  const titulo = dentroDeCarpeta
    ? `<div style="font-size:12px;font-weight:600;color:var(--text-g);margin:0 0 10px;">📄 Documentos en esta carpeta (${pdfs.length})</div>`
    : '';
  return `${titulo}
    <div class="bulk-bar" id="pdf-bulk-bar">
      <input type="checkbox" class="row-cb" id="cb-all-pdfs" onchange="toggleAllPdfs(this.checked)" title="Seleccionar todos">
      <span style="font-size:13px;font-weight:600;color:var(--blue);" id="pdf-sel-count">0 seleccionados</span>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="bulk-mover-select" style="padding:6px 10px;border:1.5px solid var(--blue-l);border-radius:8px;font-size:12px;font-family:inherit;">
          ${_buildMateriaOpts()}
        </select>
        <button class="btn-sm btn-blue" onclick="moverSeleccionados()" style="padding:7px 14px;">📂 Mover</button>
        <button class="btn-sm btn-red" onclick="deleteSelectedPdfs()" style="padding:7px 14px;">🗑️ Eliminar</button>
      </div>
    </div>
    <table class="data-table"><thead><tr>
      <th style="width:36px;"><input type="checkbox" class="row-cb" id="cb-head-pdfs" onchange="toggleAllPdfs(this.checked)"></th>
      <th>Documento</th><th>Carpeta</th><th>Pág.</th><th>Acciones</th>
    </tr></thead><tbody>
    ${pdfs.map(p=>`<tr id="row-pdf-${p.id}" onclick="togglePdfRow('${p.id}',event)">
      <td><input type="checkbox" class="row-cb pdf-cb" id="cb-pdf-${p.id}" value="${p.id}" onchange="updatePdfBulkBar()" onclick="event.stopPropagation()"></td>
      <td>
        <div style="font-weight:600;color:var(--navy);font-size:13px;">${escHtml(p.nombre||'Sin nombre')}</div>
        <div style="font-size:11px;color:var(--text-g);">${p.paginas||'?'} pág.${p.urlPdf?' · <span style="color:var(--green);">🔗 URL</span>':''}</div>
      </td>
      <td>
        <select onchange="event.stopPropagation();moverPdf('${p.id}',this.value,this)"
          style="padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;font-size:11px;font-family:inherit;outline:none;max-width:200px;">
          ${_buildMateriaOpts(p.categoria)}
        </select>
      </td>
      <td style="text-align:center;">${p.paginas||'?'}</td>
      <td style="white-space:nowrap;">
        <button class="btn-sm btn-blue" onclick="event.stopPropagation();editarUrlPdf('${p.id}','${escJsAttr(p.nombre||'')}','${escJsAttr(p.urlPdf||'')}')">✏️ URL</button>
        <button class="btn-sm btn-red" onclick="event.stopPropagation();deletePdf('${p.id}','${escJsAttr(p.nombre||'')}')">🗑️</button>
      </td>
    </tr>`).join('')}
    </tbody></table>`;
}

// Explorador de carpetas de Documentos (admin): tarjetas de subcarpetas +
// documentos archivados directamente en la carpeta actual. Clic en una
// tarjeta entra a esa carpeta; soporta anidado ilimitado igual que la
// Biblioteca del usuario y "Mover carpetas" en Materias.
function _renderAdminExplorador(){
  const el = document.getElementById('admin-pdf-list');
  if(!el) return;
  let m = _adminCarpetaActual ? allMaterias.find(x=>x.id===_adminCarpetaActual) : null;
  if(_adminCarpetaActual && !m){ _adminCarpetaActual=null; m=null; } // la carpeta ya no existe (borrada) -> vuelve a raíz

  const subcarpetas = allMaterias.filter(h=>(h.parentId||null)===_adminCarpetaActual);
  const pdfsAqui = _pdfsDirectosDeCarpeta(m ? m.nombre : null);

  let html = '';
  if(m){
    html += `<div style="font-size:13px;margin-bottom:12px;">${_adminBreadcrumbHtml(_adminCarpetaActual)}</div>`;
    html += `<button onclick="_adminVolverCarpeta()" style="display:inline-flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius-s);padding:7px 14px;font-size:12px;font-weight:600;color:var(--navy);cursor:pointer;margin-bottom:14px;">← Volver</button>`;
  }

  if(subcarpetas.length){
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:${pdfsAqui.length?'24px':'4px'};">`;
    html += subcarpetas.map(h=>_adminCarpetaCard(h)).join('');
    html += `</div>`;
  }

  if(!subcarpetas.length && !pdfsAqui.length){
    html += `<div class="empty-state"><div class="es-icon">📂</div><p>${m?`No hay documentos en "${escHtml(m.nombre)}".`:'No hay documentos aún.<br>Sube el primero.'}</p></div>`;
    el.innerHTML = html;
    return;
  }

  if(pdfsAqui.length) html += _adminPdfTablaHtml(pdfsAqui, !!m);

  el.innerHTML = html;
}

async function moverPdf(pdfId, nuevaCat, selectEl){
  if(!nuevaCat){ showToast('Selecciona una carpeta destino.','red'); return; }
  try{
    await db.ref(`${DB_PATH}/pdfs/${pdfId}/categoria`).set(nuevaCat);
    // Actualizar allPdfs local
    const p = allPdfs.find(x=>x.id===pdfId);
    if(p) p.categoria = nuevaCat;
    if(selectEl) selectEl.style.borderColor='var(--green)';
    setTimeout(()=>{ if(selectEl) selectEl.style.borderColor=''; }, 1200);
    showToast('Movido a "'+nuevaCat+'" ✓','green');
    _renderAdminExplorador(); // refresca: el doc puede haber salido de la carpeta actual
  } catch(e){ showToast('Error: '+e.message,'red'); }
}

async function moverSeleccionados(){
  const ids = [...document.querySelectorAll('.pdf-cb:checked')].map(cb=>cb.value);
  const cat = document.getElementById('bulk-mover-select')?.value;
  if(!ids.length){ showToast('Selecciona al menos un documento.','red'); return; }
  if(!cat){ showToast('Selecciona la carpeta destino.','red'); return; }
  const updates = {};
  ids.forEach(id=>{ updates[`${DB_PATH}/pdfs/${id}/categoria`]=cat; });
  await db.ref().update(updates);
  ids.forEach(id=>{ const p=allPdfs.find(x=>x.id===id); if(p) p.categoria=cat; });
  showToast(`${ids.length} doc(s) movidos a "${cat}" ✓`,'green');
  loadAdminPdfs();
}

function togglePdfRow(id, e){
  if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return;
  const cb = document.getElementById(`cb-pdf-${id}`);
  if(cb){ cb.checked=!cb.checked; updatePdfBulkBar(); }
}
function toggleAllPdfs(checked){
  document.querySelectorAll('.pdf-cb').forEach(cb=>cb.checked=checked);
  document.querySelectorAll('#cb-head-pdfs,#cb-all-pdfs').forEach(cb=>cb.checked=checked);
  updatePdfBulkBar();
}
function updatePdfBulkBar(){
  const sel = [...document.querySelectorAll('.pdf-cb:checked')];
  const bar = document.getElementById('pdf-bulk-bar');
  const countEl = document.getElementById('pdf-sel-count');
  bar.classList.toggle('show', sel.length>0);
  if(countEl) countEl.textContent=`${sel.length} seleccionado${sel.length!==1?'s':''}`;
  document.querySelectorAll('.pdf-cb').forEach(cb=>{
    const row = document.getElementById(`row-pdf-${cb.value}`);
    if(row) row.classList.toggle('row-selected', cb.checked);
  });
}

async function deleteSelectedPdfs(){
  const ids = [...document.querySelectorAll('.pdf-cb:checked')].map(cb=>cb.value);
  if(!ids.length) return;
  const nombres = ids.map(id=>{ const p=allPdfs.find(pp=>pp.id===id); return p?.nombre||id; });
  modalConfirm({
    icon:'🗑️',
    title: `Eliminar ${ids.length} documento${ids.length!==1?'s':''}`,
    msg: `Se eliminarán:<br><br><strong>${nombres.map(n=>`• ${escHtml(n)}`).join('<br>')}</strong><br><br>Esta acción no se puede deshacer.`,
    okLabel:'Eliminar todo',
    onOk: async()=>{
      for(const id of ids) await db.ref(`${DB_PATH}/pdfs/${id}`).remove();
      showToast(`${ids.length} documento${ids.length!==1?'s':''} eliminado${ids.length!==1?'s':''}.`,'green');
    }
  });
}

function editarUrlPdf(id, nombre, urlActual){
  const modal = document.getElementById('modal-url-pdf');
  document.getElementById('modal-url-nombre').textContent = nombre;
  document.getElementById('modal-url-input').value = urlActual || '';
  document.getElementById('modal-url-id').value = id;
  modal.style.display='flex';
  setTimeout(()=>document.getElementById('modal-url-input').focus(),100);
}
async function guardarUrlPdf(){
  const id = document.getElementById('modal-url-id').value;
  const url = document.getElementById('modal-url-input').value.trim();
  document.getElementById('modal-url-pdf').style.display='none';
  if(url){
    await db.ref(`${DB_PATH}/pdfs/${id}/urlPdf`).set(url);
    showToast('URL guardada — el chip de cita ahora será clickeable ✓','green');
  } else {
    await db.ref(`${DB_PATH}/pdfs/${id}/urlPdf`).remove();
    showToast('URL eliminada.','');
  }
}

async function deletePdf(id, nombre){
  modalConfirm({
    icon:'🗑️',
    title:'¿Eliminar documento?',
    msg:`<strong>${escHtml(nombre)}</strong><br><br>Esta acción no se puede deshacer.`,
    okLabel:'Eliminar',
    onOk: async()=>{
      await db.ref(`${DB_PATH}/pdfs/${id}`).remove();
      showToast('Documento eliminado.','green');
    }
  });
}

// ══ USERS MANAGEMENT ══════════════════════════════════════
let _accesoUid = null;

function loadUsers(){
  db.ref(`${DB_PATH}/usuarios`).once('value', snap=>{
    const users = snap.val()||{};
    const tbody = document.getElementById('users-tbody');
    const arr = Object.entries(users).map(([uid,u])=>({uid,...u}));
    if(!arr.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text-g);padding:30px;">Sin usuarios registrados</td></tr>'; return; }
    tbody.innerHTML = arr.map(u=>{
      const carpetas = u.carpetasPermitidas;
      const accesoBadge = carpetas && carpetas.length
        ? `<span class="badge badge-blue" title="${carpetas.length} carpeta(s)">📂 ${carpetas.length} carpeta(s)</span>`
        : `<span style="font-size:11px;color:var(--text-g);">🔓 Total</span>`;
      return `<tr>
        <td><div style="font-weight:600;color:var(--navy);">${escHtml(u.nombre||'—')}</div><div style="font-size:11px;color:var(--text-g);">${u.rol==='admin'?'👑 Admin':'Usuario'}</div></td>
        <td style="font-size:12px;">${escHtml(u.email||'—')}</td>
        <td>${u.plan==='activo'||u.rol==='admin'?'<span class="badge badge-green">Activo</span>':'<span class="badge badge-red">Inactivo</span>'}</td>
        <td>${accesoBadge}</td>
        <td style="font-size:12px;">${fmtDate(u.fechaRegistro)}</td>
        <td style="white-space:nowrap;display:flex;gap:6px;">
          ${u.rol!=='admin'?`<button class="btn-sm ${u.plan==='activo'?'btn-gray':'btn-green'}" onclick="toggleUserPlan('${u.uid}','${u.plan||''}')">${u.plan==='activo'?'Desactivar':'Activar'}</button>`:''}
          ${u.rol!=='admin'?`<button class="btn-sm btn-blue" onclick="abrirAccesoCarpetas('${u.uid}','${escJsAttr(u.nombre||u.email||'')}')">📂 Acceso</button>`:'<span style="font-size:11px;color:var(--text-g);">Admin</span>'}
        </td>
      </tr>`;
    }).join('');
    // Actualizar thead
    document.querySelector('#users-table thead tr').innerHTML =
      '<th>Usuario</th><th>Email</th><th>Plan</th><th>Acceso</th><th>Registro</th><th>Acciones</th>';
  });
}

async function abrirAccesoCarpetas(uid, nombre){
  _accesoUid = uid;
  document.getElementById('panel-acceso-nombre').textContent = nombre;
  document.getElementById('panel-acceso-carpetas').style.display='';

  // Cargar permisos actuales del usuario
  const snap = await db.ref(`${DB_PATH}/usuarios/${uid}/carpetasPermitidas`).once('value');
  const permitidas = snap.val() || [];

  // Construir checkboxes jerárquicos
  const raices = allMaterias.filter(m=>!m.parentId);
  let html = '';
  raices.forEach(r=>{
    const hijos = allMaterias.filter(h=>h.parentId===r.id);
    html += `<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:10px 14px;min-width:200px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:var(--navy);cursor:pointer;">
        <input type="checkbox" class="acceso-check" value="${r.id}" ${permitidas.includes(r.id)?'checked':''} style="width:16px;height:16px;">
        ${r.icono||'📁'} ${escHtml(r.nombre)}
      </label>`;
    hijos.forEach(h=>{
      html += `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;margin-top:6px;padding-left:12px;">
        <input type="checkbox" class="acceso-check" value="${h.id}" ${permitidas.includes(h.id)?'checked':''} style="width:14px;height:14px;">
        ↳ ${h.icono||'📂'} ${escHtml(h.nombre)}
      </label>`;
    });
    html += '</div>';
  });
  document.getElementById('panel-acceso-checks').innerHTML = html || '<p style="color:var(--text-g);">No hay carpetas creadas.</p>';

  // Scroll al panel
  document.getElementById('panel-acceso-carpetas').scrollIntoView({behavior:'smooth', block:'start'});
}

function cerrarPanelAcceso(){
  document.getElementById('panel-acceso-carpetas').style.display='none';
  _accesoUid = null;
}

async function guardarAccesoCarpetas(){
  if(!_accesoUid) return;
  const ids = [...document.querySelectorAll('.acceso-check:checked')].map(cb=>cb.value);
  await db.ref(`${DB_PATH}/usuarios/${_accesoUid}/carpetasPermitidas`).set(ids.length ? ids : null);
  showToast(ids.length ? `Acceso guardado: ${ids.length} carpeta(s) ✓` : 'Acceso total guardado ✓','green');
  cerrarPanelAcceso();
  loadUsers();
}

async function quitarRestriccionesCarpetas(){
  if(!_accesoUid) return;
  await db.ref(`${DB_PATH}/usuarios/${_accesoUid}/carpetasPermitidas`).remove();
  showToast('Acceso total (sin restricción) ✓','green');
  cerrarPanelAcceso();
  loadUsers();
}

async function toggleUserPlan(uid, currentPlan){
  const newPlan = currentPlan === 'activo' ? 'inactivo' : 'activo';
  await db.ref(`${DB_PATH}/usuarios/${uid}/plan`).set(newPlan);
  showToast(`Plan ${newPlan==='activo'?'activado':'desactivado'}.`,'green');
  loadUsers();
}

// ══ MATERIAS (admin) ══════════════════════════════════════
let allMaterias = [];
let materiasSeleccionadas = new Set(); // ids marcados con checkbox para mover en lote

function loadAllMaterias(){
  db.ref(`${DB_PATH}/materias`).on('value', snap=>{
    allMaterias = [];
    const data = snap.val()||{};
    Object.entries(data).forEach(([id,m])=>{ if(m) allMaterias.push({id,...m}); });
    allMaterias.sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
    updateMateriaSelects();
    refrescarVistaActiva();
  });
}

function updateMateriaSelects(){
  // Para PDF/Audio y carpeta padre: arbol completo indentado (anidado ilimitado)
  const enOrden = _materiasEnOrden();
  let opts = '<option value="">Seleccionar materia...</option>';
  enOrden.forEach(({m,depth})=>{
    const pad = '　'.repeat(depth) + (depth>0?'↳ ':'');
    opts += `<option value="${escHtml(m.nombre)}">${pad}${escHtml(m.nombre)}</option>`;
  });
  ['pdf-categoria','audio-categoria'].forEach(id=>{ const s=document.getElementById(id); if(s) s.innerHTML=opts; });
  // Select de carpeta padre: cualquier carpeta puede ser madre (anidado ilimitado)
  const padreEl = document.getElementById('materia-padre');
  if(padreEl){
    padreEl.innerHTML = '<option value="">Raíz (sin carpeta padre)</option>' + _buildDestinoOpts(enOrden);
  }
  // Select de destino para mover carpetas en lote (misma lista jerarquica)
  const moverDestEl = document.getElementById('materias-mover-destino');
  if(moverDestEl) moverDestEl.innerHTML = '<option value="">📁 Raíz (sin carpeta padre)</option>' + _buildDestinoOpts(enOrden);
}

// Lista jerarquica de <option> (id como value) para selects de carpeta padre / destino
function _buildDestinoOpts(enOrden){
  return enOrden.map(({m,depth})=>`<option value="${m.id}">${'　'.repeat(depth)}${depth>0?'↳ ':''}${escHtml(m.nombre)}</option>`).join('');
}

function _materiaCard(m, depth=0){
  const esHijo = depth>0;
  const pdfCount = allPdfs.filter(p=>p.categoria===m.nombre).length;
  const activo = m.activo !== false;
  const tieneHijos = allMaterias.some(x=>(x.parentId||null)===m.id);
  const indent = esHijo ? `margin-left:${depth*22}px;border-left:3px solid var(--blue-l);border-radius:0 var(--radius) var(--radius) 0;` : '';
  const icoClass = tieneHijos ? 'ti-folders' : 'ti-folder';
  return `<div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;border:2px solid ${activo?'var(--green)':'var(--border)'};${indent}display:flex;align-items:center;justify-content:space-between;gap:8px;">
    <div style="display:flex;align-items:center;gap:11px;flex:1;min-width:0;">
      <input type="checkbox" id="chk-materia-${m.id}" ${materiasSeleccionadas.has(m.id)?'checked':''} onchange="toggleMateriaSeleccion('${m.id}', this.checked)" style="width:18px;height:18px;flex-shrink:0;cursor:pointer;accent-color:var(--blue);" title="Seleccionar para mover en lote">
      <span style="width:${esHijo?'30':'36'}px;height:${esHijo?'30':'36'}px;border-radius:9px;background:#eff6ff;color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:${esHijo?'17':'19'}px;flex-shrink:0;"><i class="ti ${icoClass}"></i></span>
      <div style="min-width:0;">
        <div style="font-size:${esHijo?'13':'14'}px;font-weight:600;color:${activo?'var(--navy)':'var(--text-g)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.nombre)}</div>
        <div style="font-size:11px;color:var(--text-g);">${pdfCount} doc. · <span style="color:${activo?'var(--green)':'var(--red)'};font-weight:600;">${activo?'Visible':'Oculta'}</span>${esHijo?'<span style="margin-left:6px;color:var(--text-g);">· subcarpeta</span>':''}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="btn-sm btn-blue" onclick="editarMateria('${m.id}')" style="padding:5px 9px;font-size:13px;" title="Editar"><i class="ti ti-edit"></i></button>
      <button class="btn-sm ${activo?'btn-gray':'btn-green'}" onclick="toggleMateria('${m.id}',${activo})" style="padding:5px 10px;font-size:11px;"><i class="ti ${activo?'ti-eye-off':'ti-eye'}" style="vertical-align:-2px;margin-right:4px;"></i>${activo?'Ocultar':'Activar'}</button>
      <button class="btn-sm btn-red" onclick="eliminarMateria('${m.id}','${escJsAttr(m.nombre)}',${pdfCount},'${m.parentId||''}')" style="padding:5px 9px;font-size:13px;" title="Eliminar"><i class="ti ti-trash"></i></button>
    </div>
  </div>
  <div id="edit-materia-${m.id}" style="display:none;background:#f0f6ff;border:1.5px solid var(--blue-l);border-radius:var(--radius);padding:12px 16px;margin-top:4px;${esHijo?`margin-left:${depth*22}px;`:''}">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <select id="edit-icono-${m.id}" style="font-size:20px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;outline:none;">
        ${['📚','📐','🔬','🌍','💻','🎨','🏛️','📝','🔧','⚡','🌱','🎵','📁','📂','🏥','⚖️','🔐','📊'].map(e=>`<option value="${e}" ${m.icono===e?'selected':''}>${e}</option>`).join('')}
      </select>
      <input id="edit-nombre-${m.id}" type="text" value="${escHtml(m.nombre)}"
        style="flex:1;min-width:160px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;outline:none;"
        onkeydown="if(event.key==='Enter') guardarEdicionMateria('${m.id}')">
      <button class="btn-sm btn-blue" onclick="guardarEdicionMateria('${m.id}')" style="padding:8px 16px;">💾 Guardar</button>
      <button class="btn-sm btn-gray" onclick="document.getElementById('edit-materia-${m.id}').style.display='none'" style="padding:8px 12px;">✕</button>
    </div>
  </div>`;
}

function loadMaterias(){
  const el = document.getElementById('materias-list');
  const count = document.getElementById('materias-count');
  if(!allMaterias.length){
    count.textContent='0';
    el.innerHTML='<div class="empty-state"><div class="es-icon"><i class="ti ti-folder"></i></div><p>No hay materias aún.<br>Crea la primera carpeta arriba.</p></div>';
    return;
  }
  count.textContent = allMaterias.length;
  let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  _materiasEnOrden().forEach(({m,depth})=>{ html += _materiaCard(m, depth); });
  html += '</div>';
  el.innerHTML = html;
}

// ── Mover carpetas en lote (checkbox + destino) ─────────────
function toggleMateriaSeleccion(id, checked){
  if(checked) materiasSeleccionadas.add(id); else materiasSeleccionadas.delete(id);
  _actualizarBarraMover();
}

function seleccionarTodasMaterias(){
  allMaterias.forEach(m=>materiasSeleccionadas.add(m.id));
  loadMaterias();
  _actualizarBarraMover();
}

function deseleccionarTodasMaterias(){
  materiasSeleccionadas.clear();
  loadMaterias();
  _actualizarBarraMover();
}

function _actualizarBarraMover(){
  const bar = document.getElementById('materias-mover-bar');
  if(!bar) return;
  const n = materiasSeleccionadas.size;
  if(n===0){ bar.style.display='none'; return; }
  bar.style.display='flex';
  const countEl = document.getElementById('materias-mover-count');
  if(countEl) countEl.textContent = n;
}

// ¿targetId es rootId mismo o un descendiente suyo (a cualquier profundidad)?
// Sirve para no permitir mover una carpeta dentro de sí misma o de su propia subcarpeta.
function _idEnSubarbol(rootId, targetId){
  if(rootId===targetId) return true;
  return allMaterias.filter(m=>m.parentId===rootId).some(h=>_idEnSubarbol(h.id, targetId));
}

async function moverMateriasSeleccionadas(){
  const destino = document.getElementById('materias-mover-destino').value || null;
  if(!materiasSeleccionadas.size){ showToast('No hay carpetas seleccionadas.','red'); return; }

  const updates = {};
  let movidas = 0, omitidas = 0;
  materiasSeleccionadas.forEach(id=>{
    // Invalida: mover una carpeta dentro de sí misma o dentro de su propia subcarpeta (ciclo)
    if(destino && _idEnSubarbol(id, destino)){ omitidas++; return; }
    updates[`${DB_PATH}/materias/${id}/parentId`] = destino; // null = queda en la raíz
    movidas++;
  });

  if(movidas===0){ showToast('Ninguna se pudo mover: el destino elegido está dentro de las carpetas seleccionadas.','red'); return; }

  try{
    await db.ref().update(updates);
    materiasSeleccionadas.clear();
    _actualizarBarraMover();
    showToast(`${movidas} carpeta${movidas!==1?'s':''} movida${movidas!==1?'s':''} ✓${omitidas?` (${omitidas} omitida${omitidas!==1?'s':''}: destino inválido)`:''}`, 'green');
  } catch(e){
    showToast('Error al mover: '+e.message,'red');
  }
}

async function crearMateria(){
  const nombre = document.getElementById('materia-nombre').value.trim();
  const icono  = document.getElementById('materia-icono').value;
  const parentId = document.getElementById('materia-padre').value || null;
  if(!nombre){ showToast('Escribe el nombre de la carpeta.','red'); return; }
  if(allMaterias.find(m=>m.nombre.toLowerCase()===nombre.toLowerCase())){
    showToast('Ya existe una carpeta con ese nombre.','red'); return;
  }
  const data = { nombre, icono, activo: true, fechaCreacion: new Date().toISOString() };
  if(parentId) data.parentId = parentId;
  await db.ref(`${DB_PATH}/materias`).push(data);
  document.getElementById('materia-nombre').value='';
  document.getElementById('materia-padre').value='';
  const tipo = parentId ? 'Subcarpeta' : 'Carpeta';
  showToast(`${tipo} "${nombre}" creada ✓`,'green');
}

async function eliminarMateria(id, nombre, pdfCount, parentId){
  const hijos = allMaterias.filter(h=>h.parentId===id);
  if(hijos.length>0){ showToast(`No puedes eliminar "${nombre}" — tiene ${hijos.length} subcarpeta(s). Elimínalas primero.`,'red'); return; }
  if(pdfCount>0){ showToast(`No puedes eliminar "${nombre}" — tiene ${pdfCount} documento(s). Primero elimínalos.`,'red'); return; }
  modalConfirm({
    icon:'📁',
    title:'¿Eliminar carpeta?',
    msg:`<strong>${escHtml(nombre)}</strong><br><br>Esta acción no se puede deshacer.`,
    okLabel:'Eliminar carpeta',
    onOk: async()=>{
      await db.ref(`${DB_PATH}/materias/${id}`).remove();
      showToast('Carpeta eliminada.','green');
    }
  });
}

function editarMateria(id){
  // Cerrar cualquier otro editor abierto
  document.querySelectorAll('[id^="edit-materia-"]').forEach(el=>el.style.display='none');
  const panel = document.getElementById(`edit-materia-${id}`);
  if(panel) panel.style.display='';
  const inp = document.getElementById(`edit-nombre-${id}`);
  if(inp){ inp.focus(); inp.select(); }
}

async function guardarEdicionMateria(id){
  const inputNombre = document.getElementById('edit-nombre-' + id);
  const inputIcono  = document.getElementById('edit-icono-'  + id);
  const nuevoNombre = inputNombre ? inputNombre.value.trim() : '';
  const nuevoIcono  = inputIcono  ? inputIcono.value         : '';
  if(!nuevoNombre){ showToast('El nombre no puede estar vacío.','red'); return; }
  try{
    // Leer nombre actual desde Firebase (no depende de allMaterias en memoria)
    const snapNombre = await db.ref(`${DB_PATH}/materias/${id}/nombre`).once('value');
    const nombreViejo = snapNombre.val() || '';

    const updates = {};
    updates[`${DB_PATH}/materias/${id}/nombre`] = nuevoNombre;
    if(nuevoIcono) updates[`${DB_PATH}/materias/${id}/icono`] = nuevoIcono;

    // Reasignar PDFs y audios si cambió el nombre
    if(nombreViejo && nuevoNombre !== nombreViejo){
      allPdfs.filter(p=>p.categoria===nombreViejo)
             .forEach(p=>{ updates[`${DB_PATH}/pdfs/${p.id}/categoria`]=nuevoNombre; });
      allAudios.filter(a=>a.categoria===nombreViejo)
               .forEach(a=>{ updates[`${DB_PATH}/audios/${a.id}/categoria`]=nuevoNombre; });
    }

    await db.ref().update(updates);
    showToast('Carpeta "'+nuevoNombre+'" guardada ✓','green');
    const panel = document.getElementById('edit-materia-' + id);
    if(panel) panel.style.display='none';
  } catch(e){
    showToast('Error al guardar: '+e.message,'red');
  }
}

async function toggleMateria(id, activo){
  await db.ref(`${DB_PATH}/materias/${id}/activo`).set(!activo);
  showToast(!activo ? 'Carpeta activada — ahora es visible para usuarios ✓' : 'Carpeta oculta — los usuarios no la verán', !activo?'green':'');
}

// ══ AUDIOS (admin) ════════════════════════════════════════
function updateAudioSelects(){
  // Reusar la misma lógica jerárquica que updateMateriaSelects
  updateMateriaSelects();
}

function loadAdminAudios(){
  updateAudioSelects();
  const el = document.getElementById('admin-audio-list');
  const count = document.getElementById('admin-audio-count');
  if(!el) return;
  if(!allAudios.length){ count.textContent='0'; el.innerHTML='<div class="empty-state"><div class="es-icon">🎵</div><p>No hay audios aún.<br>Agrega el primero arriba.</p></div>'; return; }
  count.textContent=allAudios.length;
  el.innerHTML=`<table class="data-table"><thead><tr><th>Nombre</th><th>Tipo</th><th>Materia</th><th>Fuente</th><th>Fecha</th><th>Acción</th></tr></thead><tbody>
    ${allAudios.map(a=>{
      const tipo = a.tipo||'audio';
      const tipoLabel = tipo==='video'?'🎬 Video': tipo==='youtube'?'▶️ YouTube':'🎵 Audio';
      const tipoColor = tipo==='audio'?'badge-blue': tipo==='youtube'?'badge-red':'badge-green';
      const url = a.urlMedia||a.urlAudio||'';
      return `<tr>
        <td><div style="font-weight:600;color:var(--navy);">${escHtml(a.nombre||'Sin nombre')}</div><div style="font-size:11px;color:var(--text-g);">${escHtml(a.descripcion||'')}</div></td>
        <td><span class="badge ${tipoColor}">${tipoLabel}</span></td>
        <td><span class="badge badge-blue">${escHtml(a.categoria||'—')}</span></td>
        <td style="text-align:center;">${url?`<a href="${url}" target="_blank" style="color:var(--green);font-size:18px;">🔗</a>`:'<span style="color:var(--border);">—</span>'}</td>
        <td>${fmtDate(a.fechaSubida)}</td>
        <td><button class="btn-sm btn-red" onclick="deleteAudio('${a.id}','${escJsAttr(a.nombre||'')}')">🗑️</button></td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

// ── UI toggles multimedia form ─────────────────────────────
let _mediaTipo = 'audio';

function setTipo(t){
  _mediaTipo = t;
  ['audio','video','youtube'].forEach(x=>{
    const btn = document.getElementById(`tipo-btn-${x}`);
    if(btn) btn.classList.toggle('active', x===t);
  });
  const labels = {
    audio:   { label:'Link del audio (OneDrive, Google Drive, .mp3 directo)', hint:'💡 Funciona con OneDrive, Google Drive o cualquier link directo a .mp3 .m4a .wav', btn:'🎵 Agregar audio', ph:'https://...' },
    video:   { label:'Link del video (.mp4 directo, OneDrive, Google Drive)', hint:'💡 Pega un link directo a archivo de video. Para YouTube usa la opción YouTube.', btn:'🎬 Agregar video', ph:'https://...' },
    youtube: { label:'Link de YouTube', hint:'💡 Pega el link normal de YouTube (youtube.com/watch?v=...). Se incrustará automáticamente.', btn:'▶️ Agregar YouTube', ph:'https://www.youtube.com/watch?v=...' }
  };
  const l = labels[t];
  document.getElementById('url-label').textContent = l.label;
  document.getElementById('url-hint').textContent = l.hint;
  document.getElementById('btn-subir-media').textContent = l.btn;
  document.getElementById('audio-url').placeholder = l.ph;
}

function _ytVideoId(url){
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function subirMedia(){
  const nombre = document.getElementById('audio-nombre').value.trim();
  const cat    = document.getElementById('audio-categoria').value;
  const desc   = document.getElementById('audio-desc').value.trim();
  const rawUrl = document.getElementById('audio-url').value.trim();
  if(!nombre){ showToast('Escribe el nombre.','red'); return; }
  if(!cat){ showToast('Selecciona una materia.','red'); return; }
  if(!rawUrl){ showToast('Pega la URL.','red'); return; }

  let urlMedia = rawUrl, tipo = _mediaTipo;

  if(tipo === 'youtube'){
    const vid = _ytVideoId(rawUrl);
    if(!vid){ showToast('Link de YouTube no válido.','red'); return; }
    urlMedia = `https://www.youtube.com/embed/${vid}`;
  }

  const btn = document.getElementById('btn-subir-media');
  btn.disabled = true;
  try{
    const newRef = db.ref(`${DB_PATH}/audios`).push();
    await newRef.set({ id: newRef.key, nombre, categoria: cat, tipo, urlMedia, descripcion: desc, fechaSubida: new Date().toISOString(), subidoPor: currentUser.email });
    document.getElementById('audio-nombre').value='';
    document.getElementById('audio-url').value='';
    document.getElementById('audio-desc').value='';
    showToast(`"${nombre}" agregado ✓`,'green');
    loadAdminAudios();
  } catch(e){
    showToast('Error: '+e.message,'red');
  }
  btn.disabled = false;
}

async function subirAudio(){ return subirMedia(); }

async function deleteAudio(id, nombre){
  modalConfirm({
    icon:'🎵', title:'¿Eliminar audio?',
    msg:`<strong>${escHtml(nombre)}</strong><br><br>Esta acción no se puede deshacer.`,
    okLabel:'Eliminar',
    onOk: async()=>{
      await db.ref(`${DB_PATH}/audios/${id}`).remove();
      showToast('Audio eliminado.','green');
      loadAdminAudios();
    }
  });
}

// ══ AUDIOS (usuario) ══════════════════════════════════════
let currentLibTab = 'pdfs';

function switchLibTab(tab){
  currentLibTab = tab;
  document.getElementById('lib-tab-pdfs').style.display = tab==='pdfs' ? '' : 'none';
  document.getElementById('lib-tab-audios').style.display = tab==='audios' ? '' : 'none';
  document.getElementById('tab-pdfs').style.color = tab==='pdfs' ? 'var(--blue)' : 'var(--text-g)';
  document.getElementById('tab-pdfs').style.borderBottomColor = tab==='pdfs' ? 'var(--blue)' : 'transparent';
  document.getElementById('tab-pdfs').style.fontWeight = tab==='pdfs' ? '700' : '600';
  document.getElementById('tab-audios').style.color = tab==='audios' ? '#7c3aed' : 'var(--text-g)';
  document.getElementById('tab-audios').style.borderBottomColor = tab==='audios' ? '#7c3aed' : 'transparent';
  if(tab==='audios') renderAudioGrid(currentMateria);
}

function renderAudioGrid(materia){
  const el = document.getElementById('lib-audio-grid');
  if(!el) return;
  const audios = materia
    ? allAudios.filter(a=>a.categoria===materia||a.categoria===materia)
    : allAudios;
  if(!audios.length){
    el.innerHTML='<div class="empty-state" style="grid-column:1/-1;"><div class="es-icon">🎧</div><p>No hay audios en esta materia aún.</p></div>';
    return;
  }
  el.innerHTML = audios.map(a=>{
    const tipo = a.tipo || 'audio';
    const url  = a.urlMedia || a.urlAudio || '';
    const meta = escHtml(a.descripcion||'');

    if(tipo === 'youtube'){
      return `<div class="video-card">
        <iframe class="video-card-player" src="${url}" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>
        <div class="video-card-info">
          <div class="video-card-name">▶️ ${escHtml(a.nombre||'Sin nombre')}</div>
          ${meta ? `<div class="video-card-meta">${meta}</div>` : ''}
        </div>
      </div>`;
    }

    if(tipo === 'video'){
      return `<div class="video-card">
        <video class="video-card-player" controls preload="metadata">
          <source src="${url}">Tu navegador no soporta video.
        </video>
        <div class="video-card-info">
          <div class="video-card-name">🎬 ${escHtml(a.nombre||'Sin nombre')}</div>
          ${meta ? `<div class="video-card-meta">${meta}</div>` : ''}
        </div>
      </div>`;
    }

    // Audio (archivo subido o link)
    if(url && (url.match(/\.(mp3|m4a|wav|ogg|aac)(\?|$)/i) || a.tipo==='audio')){
      return `<div class="audio-card">
        <div class="audio-headphones">🎧</div>
        <div class="audio-card-name">${escHtml(a.nombre||'Sin nombre')}</div>
        <div class="audio-card-meta">${meta}</div>
        <audio controls style="width:100%;margin-top:4px;border-radius:8px;" preload="none">
          <source src="${url}">
        </audio>
      </div>`;
    }

    // Audio link externo (OneDrive, etc.)
    return `<div class="audio-card">
      <div class="audio-headphones">🎧</div>
      <div class="audio-card-name">${escHtml(a.nombre||'Sin nombre')}</div>
      <div class="audio-card-meta">${meta}</div>
      ${url
        ? `<a class="audio-listen-btn" href="${url}" target="_blank" rel="noopener">▶ Escuchar</a>`
        : `<div class="audio-no-url">⚠️ Sin URL configurada</div>`}
    </div>`;
  }).join('');
}

// ══ USER LIBRARY ══════════════════════════════════════════
let currentMateria = null;

function loadUserLibrary(){
  volverCarpetas();
}

function _carpetaCard(m, onclick){
  const pdfCount = allPdfs.filter(p=>p.categoria===m.nombre).length;
  const audioCount = allAudios.filter(a=>a.categoria===m.nombre).length;
  const hijos = allMaterias.filter(h=>h.parentId===m.id && h.activo!==false && _carpetaPermitida(h));
  const tieneHijos = hijos.length>0;
  const subInfo = tieneHijos
    ? `${hijos.length} subcarpeta${hijos.length!==1?'s':''}`
    : `${pdfCount} documento${pdfCount!==1?'s':''}${audioCount?` · ${audioCount} audio${audioCount!==1?'s':''}`:''}`;
  return `<div onclick="${onclick}" class="biblio-card">
    <div class="biblio-ic"><i class="ti ${tieneHijos?'ti-folders':'ti-folder'}"></i></div>
    <div class="biblio-card-nm">${escHtml(m.nombre)}</div>
    <div class="biblio-card-mt">${subInfo}</div>
  </div>`;
}

// ¿Tiene m (en cualquier profundidad) algún descendiente permitido? Sirve para
// que una carpeta intermedia sea navegable aunque solo un nieto suyo esté
// autorizado explícitamente.
function _tieneDescendientePermitido(id){
  return allMaterias.some(h=>h.parentId===id &&
    (userCarpetasPermitidas.includes(h.id) || _tieneDescendientePermitido(h.id)));
}

function _carpetaPermitida(m){
  // Admin o sin restricción → todas visibles
  if(isAdmin || !userCarpetasPermitidas) return true;
  // Permitida directamente
  if(userCarpetasPermitidas.includes(m.id)) return true;
  // O tiene algún descendiente permitido a cualquier profundidad (hay que
  // poder atravesarla para llegar a él)
  return _tieneDescendientePermitido(m.id);
}

function renderCarpetas(){
  const el = document.getElementById('lib-carpetas-grid');
  const raices = allMaterias.filter(m=>m.activo!==false && !m.parentId && _carpetaPermitida(m));
  if(!raices.length){
    el.innerHTML='<div class="empty-state" style="grid-column:1/-1;"><div class="es-icon">📂</div><p>No hay materias disponibles aún.</p></div>';
    return;
  }
  el.innerHTML = raices.map(m=>_carpetaCard(m, `abrirCarpeta('${m.id}')`)).join('');
}

// Devuelve la ruta desde la raíz hasta la carpeta id (inclusive), para el breadcrumb
function _rutaMateria(id){
  const ruta = [];
  let cur = id ? allMaterias.find(x=>x.id===id) : null;
  while(cur){
    ruta.unshift(cur);
    cur = cur.parentId ? allMaterias.find(x=>x.id===cur.parentId) : null;
  }
  return ruta;
}

function _renderBreadcrumb(id){
  const el = document.getElementById('lib-breadcrumb');
  if(!el) return;
  const ruta = _rutaMateria(id);
  if(!ruta.length){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='';
  let html = `<span onclick="volverCarpetas()" style="cursor:pointer;font-weight:600;color:var(--blue);">Biblioteca</span>`;
  ruta.forEach((m,i)=>{
    const esUltimo = i===ruta.length-1;
    html += ` <span style="color:var(--border);">/</span> `;
    html += esUltimo
      ? `<span style="color:var(--text-g);">${escHtml(m.nombre)}</span>`
      : `<span onclick="abrirCarpeta('${m.id}')" style="cursor:pointer;font-weight:600;color:var(--blue);">${escHtml(m.nombre)}</span>`;
  });
  el.innerHTML = html;
}

// Navega a la carpeta id: si tiene subcarpetas visibles las muestra, si no
// muestra sus documentos/audios. Soporta anidado ilimitado — el botón
// "Volver" y el breadcrumb apuntan siempre al padre real de la carpeta.
function abrirCarpeta(id){
  const m = allMaterias.find(x=>x.id===id);
  if(!m) return;
  const hijos = allMaterias.filter(h=>h.parentId===id && h.activo!==false && _carpetaPermitida(h));
  _renderBreadcrumb(id);

  if(hijos.length>0){
    currentMateria = null;
    document.getElementById('lib-titulo').textContent = m.nombre;
    document.getElementById('lib-subtitulo').textContent = 'Selecciona una subcarpeta';
    document.getElementById('lib-carpetas-view').style.display='';
    document.getElementById('lib-pdfs-view').style.display='none';
    const el = document.getElementById('lib-carpetas-grid');
    const volverA = m.parentId ? `abrirCarpeta('${m.parentId}')` : 'volverCarpetas()';
    el.innerHTML =
      `<div style="grid-column:1/-1;margin-bottom:4px;">
        <button onclick="${volverA}" style="display:inline-flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius-s);padding:8px 16px;font-size:13px;font-weight:600;color:var(--navy);cursor:pointer;">← Volver</button>
      </div>` +
      hijos.map(h=>_carpetaCard(h, `abrirCarpeta('${h.id}')`)).join('');
  } else {
    currentMateria = m.nombre;
    currentLibTab = 'pdfs';
    document.getElementById('lib-titulo').textContent = m.nombre;
    document.getElementById('lib-subtitulo').textContent = 'Documentos y audios de esta carpeta';
    document.getElementById('lib-carpetas-view').style.display='none';
    document.getElementById('lib-pdfs-view').style.display='';
    const btn = document.getElementById('lib-volver-btn');
    if(btn){
      btn.textContent='← Volver';
      btn.onclick = m.parentId ? ()=>abrirCarpeta(m.parentId) : volverCarpetas;
    }
    switchLibTab('pdfs');
    renderLibraryGrid(allPdfs.filter(p=>p.categoria===m.nombre));
    renderAudioGrid(m.nombre);
  }
}

function volverCarpetas(){
  currentMateria = null;
  document.getElementById('lib-titulo').textContent = 'Biblioteca';
  document.getElementById('lib-subtitulo').textContent = 'Selecciona una materia para ver sus documentos';
  document.getElementById('lib-carpetas-view').style.display='';
  document.getElementById('lib-pdfs-view').style.display='none';
  const searchEl = document.getElementById('lib-search');
  if(searchEl) searchEl.value='';
  _renderBreadcrumb(null);
  renderCarpetas();
}

function filterLibrary(){
  const q = (document.getElementById('lib-search').value||'').toLowerCase();
  const base = currentMateria ? allPdfs.filter(p=>p.categoria===currentMateria) : allPdfs;
  renderLibraryGrid(base.filter(p=>!q||(p.nombre||'').toLowerCase().includes(q)||(p.descripcion||'').toLowerCase().includes(q)));
}

function renderLibraryGrid(pdfs){
  const el = document.getElementById('lib-grid');
  if(!pdfs.length){ el.innerHTML='<div class="empty-state" style="grid-column:1/-1;"><div class="es-icon"><i class="ti ti-file-search"></i></div><p>No hay documentos en esta materia.</p></div>'; return; }
  el.innerHTML = pdfs.map(p=>`
    <div class="doc-card">
      <div class="doc-top">
        <div class="doc-ic"><i class="ti ti-file-text"></i></div>
        <div style="min-width:0;">
          <div class="doc-nm">${escHtml(p.nombre||'Sin nombre')}</div>
          <div class="doc-meta">
            <span class="doc-chip">${escHtml(p.categoria||'Sin materia')}</span>
            <span class="doc-pg">${p.paginas||'?'} págs.</span>
          </div>
        </div>
      </div>
      ${p.descripcion?`<div style="font-size:12.5px;color:var(--text-g);line-height:1.5;margin-bottom:12px;">${escHtml(p.descripcion)}</div>`:''}
      <div class="doc-acts">
        <button class="doc-btn doc-btn-a" onclick="goToConsultarWith('${p.id}')"><i class="ti ti-message-2"></i>Consultar</button>
        <button class="doc-btn doc-btn-s" onclick="abrirCuestionario('${p.id}')"><i class="ti ti-list-check"></i>Cuestionario</button>
      </div>
    </div>`).join('');
}
function goToConsultarWith(pdfId){
  goTo('consultar');
  setTimeout(()=>{
    const chk = document.getElementById(`chk-pdf-${pdfId}`);
    if(chk){ chk.checked=true; }
  }, 200);
}

// ══ PDF SELECTOR ══════════════════════════════════════════
function loadPdfSelector(){
  // Poblar select de carpetas
  const sel = document.getElementById('consultar-carpeta');
  if(sel){
    const activas = allMaterias.filter(m=>m.activo!==false);
    sel.innerHTML = '<option value="">— Todas las carpetas —</option>' +
      activas.map(m=>`<option value="${escHtml(m.nombre)}">${m.icono||'📁'} ${escHtml(m.nombre)}</option>`).join('');
  }
  filtrarPdfsPorCarpeta();
}

function filtrarPdfsPorCarpeta(){
  const carpeta = (document.getElementById('consultar-carpeta')?.value)||'';
  const pdfs = carpeta ? allPdfs.filter(p=>_nombresConDescendientes(carpeta).has(p.categoria)) : allPdfs;
  renderPdfSelectorList(pdfs);
}

function renderPdfSelectorList(pdfs){
  const el = document.getElementById('pdf-selector-list');
  if(!pdfs.length){
    el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-g);font-size:13px;">Sin documentos en esta carpeta.</div>';
    return;
  }
  el.innerHTML = pdfs.map(p=>`
    <div class="pdf-item">
      <input type="checkbox" id="chk-pdf-${p.id}" value="${p.id}">
      <div class="pi-info">
        <div class="pi-name">${escHtml(p.nombre||'Sin nombre')}</div>
        <div class="pi-cat">${p.paginas||'?'} pág.</div>
      </div>
    </div>`).join('');
}

// ══ CLAUDE QUERY ══════════════════════════════════════════
const SYSTEM_PROMPT = `Eres un asistente académico que explica el contenido de documentos de forma clara y cercana, como un profesor que conoce bien el material.

CÓMO RESPONDER:
1. Explica con tus propias palabras, de forma natural y comprensible — no copies texto literal del documento.
2. Usa un tono conversacional pero preciso: como si le explicaras a un compañero que necesita entender el tema.
3. Si el tema no está en los documentos, dilo de forma natural: "Ese tema no aparece en los documentos que tienes seleccionados."
4. Siempre indica de dónde viene la información con el formato: [Archivo: nombre.pdf | Página: X]
5. Si la información aparece en varias páginas, cita todas las fuentes relevantes.
6. Estructura tu respuesta así:
   💡 [explicación clara y humanizada del tema]
   📄 FUENTE: [Archivo: X | Página: Y]
   💬 FRAGMENTO: "[cita textual del documento]"`;

async function sendQuery(){
  const input = document.getElementById('chat-input');
  const pregunta = input.value.trim();
  if(!pregunta) return;
  const selected = [...document.querySelectorAll('#pdf-selector-list input:checked')].map(c=>c.value);
  if(!selected.length){ showToast('Selecciona al menos un documento.','red'); return; }

  // Cargar key si no está en memoria
  if(!CLAUDE_API_KEY) await loadClaudeKey();
  if(!CLAUDE_API_KEY){ showToast('No hay API Key configurada. Ve a Ajustes.','red'); return; }

  // Check plan
  const userSnap = await db.ref(`${DB_PATH}/usuarios/${currentUser.uid}`).once('value');
  const userData = userSnap.val()||{};
  if(userData.plan !== 'activo' && userData.rol !== 'admin'){
    showToast('Tu cuenta no tiene membresía activa. Contacta al administrador.','red'); return;
  }

  input.value='';
  const btn = document.getElementById('btn-send');
  btn.disabled=true;

  appendMessage('user', pregunta);
  const streamDiv = appendStreamingMsg();

  try {
    const textoContexto = await buildContext(selected);

    const resp = await fetch('https://biblioia-proxy.maahantartico.workers.dev/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2600,
        thinking: { type: 'disabled' },
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `DOCUMENTOS DISPONIBLES:\n\n${textoContexto}\n\n---\n\nPREGUNTA DEL ESTUDIANTE:\n${pregunta}`
        }]
      })
    });

    if(!resp.ok){
      if(resp.status === 429) throw new Error('RATE_LIMIT');
      let errMsg = 'Error al conectar con la IA.';
      try { const errData = await resp.json(); errMsg = errData.error?.message || errMsg; } catch(_){}
      throw new Error(errMsg);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for(const line of lines){
        if(!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if(raw === '[DONE]') continue;
        try{
          const evt = JSON.parse(raw);
          if(evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta'){
            fullText += evt.delta.text;
            updateStreamingMsg(streamDiv, fullText);
          }
        } catch(_){}
      }
    }

    finalizeStreamingMsg(streamDiv, fullText);

    const pdfNames = selected.map(id=>{ const p=allPdfs.find(pp=>pp.id===id); return p?.nombre||id; });
    await db.ref(`${DB_PATH}/consultas/${currentUser.uid}`).push({
      pregunta, respuesta: fullText,
      pdfs: pdfNames,
      fecha: new Date().toISOString()
    });
    db.ref(`${DB_PATH}/usuarios/${currentUser.uid}/consultas`).transaction(v=>(v||0)+1);

  } catch(e){
    streamDiv.remove();
    if(e.message === 'RATE_LIMIT'){
      appendMessage('ai', '⏳ Límite de uso de la API alcanzado. Espera 1 minuto e intenta de nuevo.\n\nSi ocurre con frecuencia, selecciona menos documentos a la vez.');
    } else {
      appendMessage('ai', `⚠️ Error al consultar la IA: ${e.message}`);
    }
  }
  btn.disabled=false;
}

async function buildContext(pdfIds){
  const MAX_TOTAL = 12000;
  let ctx = '';
  const perPdf = Math.floor(MAX_TOTAL / Math.max(pdfIds.length, 1));
  for(const id of pdfIds){
    const pdf = allPdfs.find(p=>p.id===id);
    if(!pdf) continue;
    let block = `\n══════════════════════════════\n`;
    block += `DOCUMENTO: "${pdf.nombre}"\n`;
    block += `Categoría: ${pdf.categoria||'—'} | Total páginas: ${pdf.paginas||'?'}\n`;
    block += `══════════════════════════════\n`;
    const snap = await db.ref(`${DB_PATH}/pdfs/${id}/texto`).once('value');
    const textos = snap.val()||{};
    let pdfText = '';
    Object.entries(textos).forEach(([idx,txt])=>{
      pdfText += `[PÁGINA ${parseInt(idx)+1}]\n${txt}\n\n`;
    });
    block += pdfText.slice(0, perPdf);
    if(pdfText.length > perPdf) block += '\n[... texto recortado para optimizar uso de API ...]\n';
    ctx += block;
  }
  return ctx;
}

function formatAIResponse(text){
  // Escapar HTML
  let html = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Convertir saltos de línea
  html = html.replace(/\n/g,'<br>');
  // Convertir citas [Archivo: X | Página: Y] en links clickeables
  html = html.replace(/\[Archivo:\s*([^\|]+?)\s*\|\s*Página:\s*(\d+)\]/g, (match, nombre, pagina) => {
    const pdfNorm = nombre.trim().toLowerCase().replace(/\.pdf$/i,'');
    const pdf = allPdfs.find(p => {
      const pNorm = (p.nombre||'').trim().toLowerCase().replace(/\.pdf$/i,'');
      return pNorm === pdfNorm || pNorm.includes(pdfNorm) || pdfNorm.includes(pNorm);
    });
    const safe = match.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    if(pdf && pdf.urlPdf){
      const url = pdf.urlPdf;
      return `<a href="${url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;color:var(--blue);font-weight:600;text-decoration:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:1px 8px;font-size:12px;" title="Abrir PDF · Página ${pagina}">📄 ${escHtml(nombre.trim())} · Pág. ${pagina} ↗</a>`;
    }
    // Si no tiene URL, mostrar solo resaltado
    return `<span style="display:inline-flex;align-items:center;gap:4px;color:var(--blue);font-weight:600;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:1px 8px;font-size:12px;">📄 ${escHtml(nombre.trim())} · Pág. ${pagina}</span>`;
  });
  return html;
}
function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Para meter un valor dentro de onclick="fn('...')": primero cierra el atributo (& y ")
// y luego el string JS (\ y '). Evita que un nombre con comillas rompa el boton o inyecte codigo.
function escJsAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/\\/g,'\\\\').replace(/'/g,'\\x27').replace(/[\r\n\t]/g,' '); }

function appendMessage(role, text){
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  if(role === 'ai'){
    div.innerHTML = formatAIResponse(text);
  } else {
    div.textContent = text;
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}
function appendTyping(){
  const messages = document.getElementById('chat-messages');
  const id = 'typing-'+Date.now();
  const div = document.createElement('div');
  div.id=id; div.className='msg msg-ai';
  div.innerHTML='<div class="typing"><span></span><span></span><span></span></div>';
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}
function removeTyping(id){ const el=document.getElementById(id); if(el) el.remove(); }

function appendStreamingMsg(){
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg msg-ai';
  div.innerHTML = '<span class="stream-cursor"></span>';
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}
function updateStreamingMsg(div, text){
  const messages = document.getElementById('chat-messages');
  div.innerHTML = escHtml(text).replace(/\n/g,'<br>') + '<span class="stream-cursor"></span>';
  messages.scrollTop = messages.scrollHeight;
}
function finalizeStreamingMsg(div, text){
  div.innerHTML = formatAIResponse(text);
}

// ══ HISTORIAL ═════════════════════════════════════════════
function loadHistorial(){
  const el = document.getElementById('historial-list');
  el.innerHTML = '<div class="empty-state"><div class="es-icon">⏳</div><p>Cargando...</p></div>';
  db.ref(`${DB_PATH}/consultas/${currentUser.uid}`).orderByChild('fecha').once('value', snap=>{
    const data = snap.val()||{};
    const qs = Object.values(data).reverse();
    if(!qs.length){ el.innerHTML='<div class="empty-state"><div class="es-icon">💬</div><p>Aún no tienes consultas.<br>Ve a Consultar para comenzar.</p></div>'; return; }
    el.innerHTML = qs.map(q=>`
      <div class="hist-item">
        <div class="hist-q">❓ ${escHtml(q.pregunta||'')}</div>
        <div class="hist-a">${escHtml(q.respuesta||'')}</div>
        <div class="hist-meta">
          <span class="hist-date">🕐 ${fmtDate(q.fecha)}</span>
          ${(q.pdfs||[]).map(n=>`<span class="hist-pdf">📄 ${escHtml(n)}</span>`).join('')}
        </div>
      </div>`).join('');
  });
}

// ══ BANCO DE PREGUNTAS (admin) ════════════════════════════
function initBancoPreguntas(){
  const sel = document.getElementById('banco-pdf-select');
  if(!sel) return;
  sel.innerHTML = '<option value="">— Selecciona un PDF —</option>' +
    allPdfs.map(p=>`<option value="${p.id}">${escHtml(p.nombre||'Sin nombre')}</option>`).join('');
  document.getElementById('banco-info').style.display='none';
  document.getElementById('banco-lista').innerHTML='<div class="empty-state"><div class="es-icon">📝</div><p>Selecciona un documento para ver sus preguntas.</p></div>';
}

async function loadBancoPreguntas(){
  const pdfId = document.getElementById('banco-pdf-select').value;
  if(!pdfId){ document.getElementById('banco-info').style.display='none'; return; }
  document.getElementById('banco-lista').innerHTML='<div style="padding:30px;text-align:center;color:var(--text-g);">Cargando preguntas...</div>';
  const snap = await db.ref(`${DB_PATH}/cuestionarios/${pdfId}/preguntas`).once('value');
  const data = snap.val()||{};
  const preguntas = Object.entries(data).map(([id,q])=>({id,...q}));
  const infoEl = document.getElementById('banco-info');
  const totalEl = document.getElementById('banco-total');
  if(!preguntas.length){
    infoEl.style.display='none';
    document.getElementById('banco-lista').innerHTML='<div class="empty-state"><div class="es-icon">📝</div><p>No hay preguntas aún para este documento.<br>Abre el cuestionario para generarlas.</p></div>';
    return;
  }
  infoEl.style.display='flex';
  totalEl.textContent=`📚 ${preguntas.length} pregunta${preguntas.length!==1?'s':''}`;
  document.getElementById('banco-lista').innerHTML = preguntas.map((q,i)=>`
    <div class="card" style="margin-bottom:12px;padding:18px 20px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--blue-l);">PREGUNTA ${i+1} · PÁGINA ${q.pagina||'?'}</div>
        <button class="btn-sm btn-red" onclick="eliminarPregunta('${pdfId}','${q.id}')" style="padding:4px 10px;font-size:11px;flex-shrink:0;">🗑️ Eliminar</button>
      </div>
      <div style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:12px;line-height:1.4;">${escHtml(q.pregunta||'')}</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
        ${['a','b','c','d'].map(k=>`
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:1.5px solid ${k===q.correcta?'var(--green)':'var(--border)'};background:${k===q.correcta?'#f0fdf4':'var(--bg)'};">
            <span style="width:22px;height:22px;border-radius:6px;background:${k===q.correcta?'var(--green)':'var(--border)'};color:${k===q.correcta?'#fff':'var(--text-g)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">${k.toUpperCase()}</span>
            <span style="font-size:13px;color:${k===q.correcta?'#166534':'var(--text)'};font-weight:${k===q.correcta?'700':'400'};">${escHtml(q.alternativas?.[k]||'')} ${k===q.correcta?'✓':''}</span>
          </div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-g);background:var(--bg);padding:8px 12px;border-radius:8px;border-left:3px solid var(--blue-l);">
        💬 <em>"${escHtml(q.fragmento||'')}"</em>
      </div>
    </div>`).join('');
}

async function eliminarPregunta(pdfId, preguntaId){
  modalConfirm({
    icon:'📝', title:'¿Eliminar pregunta?',
    msg:'Esta pregunta se eliminará del banco. No se puede deshacer.',
    okLabel:'Eliminar',
    onOk: async()=>{
      await db.ref(`${DB_PATH}/cuestionarios/${pdfId}/preguntas/${preguntaId}`).remove();
      showToast('Pregunta eliminada.','green');
      loadBancoPreguntas();
    }
  });
}

async function limpiarBanco(){
  const pdfId = document.getElementById('banco-pdf-select').value;
  if(!pdfId) return;
  const pdf = allPdfs.find(p=>p.id===pdfId);
  modalConfirm({
    icon:'🗑️', title:'¿Limpiar banco completo?',
    msg:`Se eliminarán <strong>todas las preguntas</strong> de <strong>${escHtml(pdf?.nombre||'este documento')}</strong>.<br><br>La próxima vez que abras el cuestionario, se generarán nuevas.`,
    okLabel:'Limpiar todo',
    onOk: async()=>{
      await db.ref(`${DB_PATH}/cuestionarios/${pdfId}/preguntas`).remove();
      showToast('Banco limpiado.','green');
      loadBancoPreguntas();
    }
  });
}

async function limpiarTodosLosBancos(){
  modalConfirm({
    icon:'⚠️', title:'¿Borrar TODOS los bancos?',
    msg:`Se eliminarán las preguntas de <strong>todos los documentos</strong>.<br><br>La próxima vez que abras cada cuestionario se regenerarán con el nuevo formato (incluye referencia de artículo).`,
    okLabel:'Borrar todo',
    onOk: async()=>{
      await db.ref(`${DB_PATH}/cuestionarios`).remove();
      showToast('Todos los bancos eliminados.','green');
      loadBancoPreguntas();
    }
  });
}

// ══ CUESTIONARIO ══════════════════════════════════════════
let currentQuizPdfId = null;
let currentQuizPreguntas = [];
let currentQuizNombre = '';
let quizRespuestasUsuario = [];

function abrirCuestionario(pdfId){
  const pdf = allPdfs.find(p=>p.id===pdfId);
  if(!pdf){ showToast('Documento no encontrado.','red'); return; }
  currentQuizPdfId = pdfId;
  currentQuizNombre = pdf.nombre||'Documento';
  goTo('cuestionario');

  const paginas = parseInt(pdf.paginas)||0;
  const target = paginas <= 50 ? 80 : paginas <= 100 ? 150 : 200;
  const tiempoMin = target === 80 ? '3-4' : target === 150 ? '6-8' : '10-14';

  document.getElementById('quiz-recommend').style.display='none';
  document.getElementById('quiz-loading').style.display='none';
  document.getElementById('quiz-form').style.display='none';
  document.getElementById('quiz-results').style.display='none';

  db.ref(`${DB_PATH}/cuestionarios/${pdfId}/preguntas`).once('value', snap=>{
    const data = snap.val()||{};
    const bancoSize = Object.values(data).filter(q=>
      q && q.pregunta && q.alternativas &&
      'a' in q.alternativas && ['a','b','c','d'].includes(q.correcta)
    ).length;

    if(bancoSize >= target){
      loadCuestionario(target);
    } else {
      mostrarRecomendacion(pdf, bancoSize, target, tiempoMin);
    }
  });
}

function mostrarRecomendacion(pdf, bancoActual, target, tiempoMin){
  const paginas = parseInt(pdf.paginas)||0;
  document.getElementById('qr-titulo').textContent = bancoActual === 0 ? 'Primera vez en este documento' : 'Banco incompleto';
  document.getElementById('qr-desc').innerHTML = bancoActual === 0
    ? `Este PDF tiene <strong>${paginas} páginas</strong>. Te recomiendo generar un banco de <strong>${target} preguntas</strong> ahora — solo esta vez. Después cada cuestionario es instantáneo y gratis.`
    : `Este PDF ya tiene <strong>${bancoActual} preguntas</strong>. Para alcanzar ${target} necesito generar ${target - bancoActual} más.`;

  document.getElementById('qr-info').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
      <div>📄 <strong>Documento:</strong> ${escHtml(pdf.nombre||'Sin nombre')}</div>
      <div>📖 <strong>Páginas:</strong> ${paginas}</div>
      <div>📝 <strong>Banco objetivo:</strong> ${target} preguntas</div>
      <div>⏱️ <strong>Tiempo estimado:</strong> ${tiempoMin} minutos (solo esta vez)</div>
      <div>♾️ <strong>Después:</strong> cuestionarios ilimitados e instantáneos</div>
    </div>`;

  const btns = document.getElementById('qr-btns');
  btns.innerHTML = '';

  const btnGenerar = document.createElement('button');
  btnGenerar.className = 'btn-primary';
  btnGenerar.style.cssText = 'padding:12px 28px;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;';
  btnGenerar.textContent = `🚀 Generar banco de ${target} preguntas`;
  btnGenerar.onclick = ()=>{ document.getElementById('quiz-recommend').style.display='none'; loadCuestionario(target); };
  btns.appendChild(btnGenerar);

  if(bancoActual >= 20){
    const btnExistente = document.createElement('button');
    btnExistente.style.cssText = 'padding:12px 20px;font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;color:var(--text);font-weight:600;';
    btnExistente.textContent = `Usar las ${bancoActual} preguntas actuales`;
    btnExistente.onclick = ()=>{ document.getElementById('quiz-recommend').style.display='none'; loadCuestionario(bancoActual); };
    btns.appendChild(btnExistente);
  }

  const btnVolver = document.createElement('button');
  btnVolver.style.cssText = 'padding:10px 16px;font-size:12px;background:none;border:none;color:var(--text-g);cursor:pointer;';
  btnVolver.textContent = '← Volver';
  btnVolver.onclick = ()=>goTo('biblioteca-user');
  btns.appendChild(btnVolver);

  document.getElementById('quiz-recommend').style.display='block';
}

async function loadCuestionario(targetSize){
  if(!currentQuizPdfId) return;
  targetSize = targetSize || 20;

  document.querySelectorAll('.quiz-retry-btn').forEach(b=>b.remove());
  document.getElementById('quiz-load-bar').style.background='';
  document.getElementById('quiz-loading').style.display='';
  document.getElementById('quiz-recommend').style.display='none';
  document.getElementById('quiz-form').style.display='none';
  document.getElementById('quiz-results').style.display='none';
  document.getElementById('quiz-revision').style.display='none';
  document.getElementById('quiz-loading-titulo').textContent=`Preparando: ${currentQuizNombre}`;
  setQuizLoadBar(5,'Revisando banco de preguntas...');

  try {
    const snap = await db.ref(`${DB_PATH}/cuestionarios/${currentQuizPdfId}/preguntas`).once('value');
    let banco = [];
    const data = snap.val()||{};
    Object.entries(data).forEach(([id,q])=>{
      if(q && q.pregunta && q.alternativas &&
         typeof q.alternativas==='object' &&
         'a' in q.alternativas && 'b' in q.alternativas &&
         'c' in q.alternativas && 'd' in q.alternativas &&
         ['a','b','c','d'].includes(q.correcta)){
        banco.push({id,...q});
      }
    });
    setQuizLoadBar(10, `Banco actual: ${banco.length} preguntas válidas`);

    // Cargar texto completo del PDF solo si necesitamos generar
    let fullCtx = '';
    if(banco.length < targetSize){
      setQuizLoadBar(15,'Cargando documento...');
      const textoSnap = await db.ref(`${DB_PATH}/pdfs/${currentQuizPdfId}/texto`).once('value');
      const textos = textoSnap.val()||{};
      Object.entries(textos).forEach(([idx,txt])=>{
        if(txt && txt.trim()) fullCtx += `[PÁGINA ${parseInt(idx)+1}]\n${txt}\n\n`;
      });
      if(fullCtx.trim().length < 100){
        throw new Error('El PDF no tiene texto extraíble (puede ser imagen escaneada). Sube un PDF con texto seleccionable.');
      }
    }

    // Dividir el documento en secciones iguales — una por lote
    // Así las preguntas quedan balanceadas en todo el documento
    const totalBatches = Math.ceil(targetSize / 10);
    const SECTION_SIZE = Math.max(4000, Math.ceil(fullCtx.length / totalBatches));
    const totalSections = Math.max(1, Math.ceil(fullCtx.length / SECTION_SIZE));
    let sectionIdx = 0;

    while(banco.length < targetSize){
      const pct = Math.min(90, 20 + (banco.length / targetSize) * 70);
      setQuizLoadBar(pct, `Generando preguntas ${banco.length} / ${targetSize}...`);

      const start = (sectionIdx % totalSections) * SECTION_SIZE;
      const textSection = fullCtx.slice(start, start + SECTION_SIZE) || fullCtx.slice(0, SECTION_SIZE);
      sectionIdx++;

      try {
        const nuevas = await generarNuevasPreguntas(currentQuizPdfId, banco.length, textSection);
        if(nuevas && nuevas.length){
          for(const q of nuevas){
            const ref = db.ref(`${DB_PATH}/cuestionarios/${currentQuizPdfId}/preguntas`).push();
            await ref.set({...q, id: ref.key});
            banco.push({...q, id: ref.key});
          }
        }
        // Pausa entre lotes para no superar el rate limit
        if(banco.length < targetSize){
          setQuizLoadBar(Math.min(90, 20 + (banco.length/targetSize)*70), `Banco: ${banco.length}/${targetSize} — esperando...`);
          await new Promise(r => setTimeout(r, 4000));
        }
      } catch(loteErr){
        if(loteErr.message === 'RATE_LIMIT'){
          setQuizLoadBar(Math.min(90, 20 + (banco.length/targetSize)*70), `Límite alcanzado — esperando 60s (${banco.length}/${targetSize})...`);
          await new Promise(r => setTimeout(r, 60000));
          continue;
        }
        if(banco.length >= 20) break;
        throw loteErr;
      }
    }

    if(!banco.length){
      mostrarErrorQuiz('No se pudieron generar preguntas.','Este documento puede ser una imagen escaneada sin texto, o hubo un problema con la IA. Intenta con otro PDF.');
      return;
    }

    const mezclado = banco.sort(()=>Math.random()-.5);
    currentQuizPreguntas = mezclado.slice(0,20);
    setQuizLoadBar(100,'¡Listo!');
    setTimeout(()=>{
      try{ renderQuiz(); }
      catch(err){ mostrarErrorQuiz('Error al mostrar el cuestionario', err.message); }
    }, 300);

  } catch(e){
    console.error('Quiz error:',e);
    if(e.message === 'RATE_LIMIT'){
      mostrarErrorQuiz('Límite de uso alcanzado','La API está temporalmente saturada. Espera 1 minuto e intenta de nuevo.');
    } else {
      mostrarErrorQuiz('Error al generar el cuestionario', e.message||'Revisa la consola para más detalles.');
    }
  }
}

function mostrarErrorQuiz(titulo, detalle){
  document.getElementById('quiz-loading-titulo').textContent = '⚠️ '+titulo;
  document.getElementById('quiz-loading-msg').textContent = detalle||'';
  document.getElementById('quiz-load-bar').style.width='0%';
  document.getElementById('quiz-load-bar').style.background='var(--red)';
  // Botón reintentar
  const loadEl = document.getElementById('quiz-loading');
  if(!loadEl.querySelector('.quiz-retry-btn')){
    const btn = document.createElement('button');
    btn.className='btn-sm btn-blue quiz-retry-btn';
    btn.style.cssText='margin-top:24px;padding:10px 24px;font-size:13px;';
    btn.textContent='🔄 Reintentar';
    btn.onclick=()=>{ btn.remove(); document.getElementById('quiz-load-bar').style.background=''; loadCuestionario(); };
    loadEl.appendChild(btn);
    const btnSalir = document.createElement('button');
    btnSalir.className='btn-sm btn-gray quiz-retry-btn';
    btnSalir.style.cssText='margin-top:24px;margin-left:10px;padding:10px 20px;font-size:13px;';
    btnSalir.textContent='← Salir';
    btnSalir.onclick=()=>goTo('biblioteca-user');
    loadEl.appendChild(btnSalir);
  }
}

async function generarNuevasPreguntas(pdfId, yaExisten, textSection){
  if(!CLAUDE_API_KEY) await loadClaudeKey();
  if(!CLAUDE_API_KEY) throw new Error('No hay API Key configurada. Ve a Ajustes y guarda la clave.');

  const prompt = `Genera exactamente 10 preguntas de selección múltiple. Responde SOLO con un array JSON válido, sin texto extra ni markdown:
[{"pregunta":"...?","alternativas":{"a":"...","b":"...","c":"...","d":"..."},"correcta":"b","pagina":1,"fragmento":"cita breve del doc","referencia":"Artículo 5° / N° 3 / Párrafo 2 (la sección exacta donde está la respuesta)"}]

REGLAS GENERALES:
- Exactamente 10 preguntas, "correcta" es a/b/c/d
- Solo usa información del documento
- No repitas las ${yaExisten} preguntas ya existentes
- Alternativas cortas (máx 12 palabras cada una)
- "referencia": indica el artículo, número, párrafo o sección específica donde está la respuesta (ej: "Artículo 184", "N° 3", "Título II", "Párrafo 1"). Si no hay referencia explícita, pon null

SOBRE EL CONTENIDO DE LAS PREGUNTAS (muy importante):
- Pregunta SOLO sobre conceptos importantes, clave y representativos de la materia
- Prioriza: definiciones fundamentales, normas o artículos relevantes, procedimientos críticos, requisitos obligatorios, conceptos que un profesional del área debe saber
- EVITA preguntas sobre detalles triviales, fechas irrelevantes o datos sin importancia práctica
- La dificultad debe ser razonable: ni tan fácil que sea obvia ni tan difícil que sea un detalle insignificante

REGLAS PARA LAS ALTERNATIVAS INCORRECTAS (crítico):
- Las 3 alternativas incorrectas deben ser PLAUSIBLES y del mismo tema del documento
- Deben representar conceptos similares, confusiones típicas o errores comunes del área
- NUNCA uses respuestas absurdas, de otro tema o fáciles de descartar de inmediato
- Si la respuesta correcta es un número/artículo/norma, las incorrectas deben ser otros números/artículos/normas del mismo documento
- El estudiante debe conocer bien el material para identificar la correcta

SECCIÓN DEL DOCUMENTO (genera preguntas SOLO sobre este fragmento):
${textSection}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(()=>controller.abort(), 90000);

  let resp;
  try {
    resp = await fetch('https://biblioia-proxy.maahantartico.workers.dev/', {
      method:'POST',
      signal: controller.signal,
      headers:{'Content-Type':'application/json','x-api-key':CLAUDE_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-sonnet-5',max_tokens:3200,thinking:{type:'disabled'},messages:[{role:'user',content:prompt}]})
    });
  } catch(fetchErr){
    if(fetchErr.name==='AbortError') throw new Error('La IA tardó demasiado (>90s). Intenta de nuevo.');
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if(!resp.ok){
    if(resp.status === 429) throw new Error('RATE_LIMIT');
    let errMsg = `Error HTTP ${resp.status}`;
    try { const errData = await resp.json(); errMsg = errData.error?.message || errMsg; } catch(_){}
    throw new Error(errMsg);
  }

  const data = await resp.json();
  if(!data.content || !data.content[0]){
    throw new Error('La IA no devolvió contenido. Intenta de nuevo.');
  }
  const text = data.content[0].text.trim();

  // Extraer JSON — busca el primer [ hasta el último ]
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if(start === -1 || end === -1) throw new Error('La IA no devolvió un JSON válido. Intenta de nuevo.');

  let preguntas;
  try {
    preguntas = JSON.parse(text.slice(start, end+1));
  } catch(e){
    throw new Error('Error al leer las preguntas generadas. Intenta de nuevo.');
  }

  if(!Array.isArray(preguntas) || preguntas.length === 0){
    throw new Error('La IA generó 0 preguntas. Verifica que el PDF tenga contenido de texto.');
  }

  return preguntas;
}

function setQuizLoadBar(pct, msg){
  document.getElementById('quiz-load-bar').style.width=pct+'%';
  document.getElementById('quiz-loading-msg').textContent=msg;
}

function renderQuiz(){
  // Filtrar preguntas con estructura mínima válida
  currentQuizPreguntas = currentQuizPreguntas.filter(q=>
    q && q.pregunta && q.alternativas &&
    typeof q.alternativas === 'object' &&
    'a' in q.alternativas && 'b' in q.alternativas &&
    'c' in q.alternativas && 'd' in q.alternativas &&
    ['a','b','c','d'].includes(q.correcta)
  );

  if(!currentQuizPreguntas.length){
    mostrarErrorQuiz('Sin preguntas válidas','Las preguntas del banco están dañadas o incompletas. Haz clic en Reintentar para generar nuevas.');
    return;
  }

  // Actualizar badge del banco (async, no bloquea)
  db.ref(`${DB_PATH}/cuestionarios/${currentQuizPdfId}/preguntas`).once('value',s=>{
    const total = Object.keys(s.val()||{}).length;
    const el = document.getElementById('quiz-banco-info');
    if(el) el.textContent=`📚 Banco: ${total} preguntas`;
  });

  const _set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  _set('quiz-pdf-nombre', currentQuizNombre);
  _set('quiz-total-label', currentQuizPreguntas.length);
  _set('quiz-res-nombre', currentQuizNombre);
  document.getElementById('quiz-progress-fill').style.width='0%';
  document.getElementById('quiz-progress-label').textContent='Responde todas las preguntas para enviar';

  const lista = document.getElementById('quiz-questions-list');
  try {
    lista.innerHTML = currentQuizPreguntas.map((q,i)=>`
      <div class="quiz-q-card" id="qcard-${i}">
        <div class="quiz-q-num">Pregunta ${i+1} de ${currentQuizPreguntas.length} · Página ${q.pagina||'?'}</div>
        <div class="quiz-q-text">${escHtml(q.pregunta||'')}</div>
        <div class="quiz-options">
          ${['a','b','c','d'].map(k=>`
            <div class="quiz-opt" id="qopt-${i}-${k}" onclick="seleccionarOpcion(${i},'${k}')">
              <div class="quiz-opt-key">${k.toUpperCase()}</div>
              <span>${escHtml((q.alternativas&&q.alternativas[k])||'')}</span>
            </div>`).join('')}
        </div>
      </div>`).join('');
    lista.addEventListener('change', actualizarProgreso);
  } catch(err){
    mostrarErrorQuiz('Error al mostrar preguntas', err.message);
    return;
  }

  // Mostrar formulario SOLO si todo fue bien
  document.getElementById('quiz-loading').style.display='none';
  document.getElementById('quiz-form').style.display='';
}

function seleccionarOpcion(qIdx, key){
  ['a','b','c','d'].forEach(k=>{
    const el = document.getElementById(`qopt-${qIdx}-${k}`);
    if(el) el.classList.toggle('selected', k===key);
  });
  actualizarProgreso();
}

function actualizarProgreso(){
  const respondidas = currentQuizPreguntas.filter((_,i)=>
    ['a','b','c','d'].some(k=>document.getElementById(`qopt-${i}-${k}`)?.classList.contains('selected'))
  ).length;
  const pct = Math.round((respondidas/currentQuizPreguntas.length)*100);
  document.getElementById('quiz-progress-fill').style.width=pct+'%';
  document.getElementById('quiz-progress-label').textContent=`${respondidas} de ${currentQuizPreguntas.length} respondidas`;
}

function enviarCuestionario(){
  // Verificar que todas estén respondidas
  const sinResponder = currentQuizPreguntas.filter((_,i)=>
    !['a','b','c','d'].some(k=>document.getElementById(`qopt-${i}-${k}`)?.classList.contains('selected'))
  );
  if(sinResponder.length>0){ showToast(`Faltan ${sinResponder.length} preguntas por responder.`,'red'); return; }

  let correctas=0;
  const pdf = allPdfs.find(p=>p.id===currentQuizPdfId);
  quizRespuestasUsuario = [];

  const resultHTML = currentQuizPreguntas.map((q,i)=>{
    const seleccionada = ['a','b','c','d'].find(k=>document.getElementById(`qopt-${i}-${k}`)?.classList.contains('selected'));
    quizRespuestasUsuario.push(seleccionada);
    const esCorrecta = seleccionada===q.correcta;
    if(esCorrecta) correctas++;
    const linkCita = pdf?.urlPdf
      ? `<a href="${pdf.urlPdf}" target="_blank" style="color:var(--blue);font-weight:600;font-size:12px;">📄 Abrir PDF · Pág. ${q.pagina||'?'} ↗</a>`
      : `<span style="font-size:12px;color:var(--text-g);">📄 ${escHtml(currentQuizNombre)} · Pág. ${q.pagina||'?'}</span>`;
    return `
      <div class="quiz-q-card" style="border-color:${esCorrecta?'var(--green)':'var(--red)'};">
        <div class="quiz-q-num" style="color:${esCorrecta?'var(--green)':'var(--red)'};">${esCorrecta?'✅':'❌'} Pregunta ${i+1} · Página ${q.pagina||'?'}</div>
        <div class="quiz-q-text">${escHtml(q.pregunta||'')}</div>
        <div class="quiz-options">
          ${['a','b','c','d'].map(k=>{
            let cls='quiz-opt';
            if(k===q.correcta) cls+=' reveal-correct';
            if(k===seleccionada && !esCorrecta) cls+=' incorrect';
            return `<div class="${cls}"><div class="quiz-opt-key">${k.toUpperCase()}</div><span>${escHtml(q.alternativas[k]||'')}</span>${k===q.correcta?'  ✓':k===seleccionada&&!esCorrecta?' ✗':''}</div>`;
          }).join('')}
        </div>
        <div class="quiz-citation show">
          💬 <em>"${escHtml(q.fragmento||'')}"</em><br><br>${linkCita}
        </div>
      </div>`;
  }).join('');

  const total = currentQuizPreguntas.length;
  const pct = Math.round((correctas/total)*100);
  const aprobado = pct >= 60;

  // Banner compacto
  const bannerEl = document.getElementById('quiz-resultado-banner');
  if(bannerEl){
    bannerEl.style.background = aprobado ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#dc2626,#b91c1c)';
    bannerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
        <div style="font-size:38px;line-height:1;">${aprobado?'🎉':'💪'}</div>
        <div style="flex:1;min-width:120px;">
          <div style="font-size:11px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px;">${currentQuizNombre}</div>
          <div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2;">${pct}% &nbsp;·&nbsp; ${correctas} de ${total} correctas</div>
          <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:3px;">${aprobado?'¡Buen trabajo! Superaste el mínimo de 60%.':'Necesitas al menos 60% para aprobar. ¡Inténtalo!'}</div>
        </div>
        <div style="padding:8px 20px;border-radius:24px;background:rgba(255,255,255,.2);border:1.5px solid rgba(255,255,255,.35);font-size:14px;font-weight:800;color:#fff;white-space:nowrap;">${aprobado?'✅ APROBADO':'❌ REPROBADO'}</div>
      </div>
    `;
  }

  document.getElementById('quiz-result-list').innerHTML=resultHTML;
  document.getElementById('quiz-form').style.display='none';
  document.getElementById('quiz-results').style.display='';
  // Scroll al tope del contenedor principal
  const mainEl = document.querySelector('.app-main');
  if(mainEl) mainEl.scrollTop = 0;
}

function repetirCuestionario(){
  // Vuelve a mostrar el mismo cuestionario con las mismas preguntas, en blanco
  document.getElementById('quiz-results').style.display='none';
  renderQuiz(); // re-renderiza las mismas preguntas sin selección
  const mainEl = document.querySelector('.app-main');
  if(mainEl) mainEl.scrollTop = 0;
}

function reiniciarCuestionario(){
  abrirCuestionario(currentQuizPdfId);
}

function abrirRevision(){
  document.getElementById('quiz-results').style.display='none';
  document.getElementById('quiz-revision').style.display='block';
  const mainEl = document.querySelector('.app-main');
  if(mainEl) mainEl.scrollTop=0;

  const lista = document.getElementById('revision-lista');
  lista.innerHTML = currentQuizPreguntas.map((q,i)=>{
    const resp = quizRespuestasUsuario[i];
    const correcta = q.correcta;
    const ok = resp === correcta;
    return `<div class="rev-q-item ${ok?'rev-correct':'rev-wrong'}" id="rev-item-${i}" onclick="mostrarPaginaRevision(${i})">
      <div style="font-size:11px;font-weight:700;color:${ok?'var(--green)':'var(--red)'};">${ok?'✅':'❌'} Pregunta ${i+1} · Pág. ${q.pagina||'?'}</div>
      <div style="font-size:12px;font-weight:600;color:var(--navy);margin-top:4px;line-height:1.4;">${escHtml(q.pregunta)}</div>
      ${!ok?`<div style="font-size:11px;margin-top:6px;color:var(--red);">Tu respuesta: ${escHtml(q.alternativas[resp]||'Sin responder')}</div>
      <div style="font-size:11px;color:var(--green);">Correcta: ${escHtml(q.alternativas[correcta])}</div>`:''}
    </div>`;
  }).join('');

  const primeraMala = currentQuizPreguntas.findIndex((_,i)=>quizRespuestasUsuario[i]!==currentQuizPreguntas[i].correcta);
  mostrarPaginaRevision(primeraMala >= 0 ? primeraMala : 0);
}

function cerrarRevision(){
  document.getElementById('quiz-revision').style.display='none';
  document.getElementById('quiz-results').style.display='';
  const mainEl = document.querySelector('.app-main');
  if(mainEl) mainEl.scrollTop=0;
}

async function mostrarPaginaRevision(idx){
  document.querySelectorAll('.rev-q-item').forEach((el,i)=>{
    el.classList.toggle('rev-active', i===idx);
  });
  const panel = document.getElementById('revision-pagina');
  panel.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-g);">Cargando página...</div>';

  const q = currentQuizPreguntas[idx];
  const pageIdx = (parseInt(q.pagina)||1) - 1;

  try{
    const snap = await db.ref(`${DB_PATH}/pdfs/${currentQuizPdfId}/texto/${pageIdx}`).once('value');
    const textoRaw = snap.val()||'(Texto de esta página no disponible)';

    // Format raw text for display: handles BOTH text with newlines AND dense single-line text
    function fmtEsc(t){
      // Newline-based: spacing before article/chapter headings
      t = t.replace(/\n(Art[íi]culo\s+\d+|ARTÍCULO\s+\d+|Art\.\s*\d+|Capítulo\s+\d+|CAPÍTULO\s+\d+)/gi,'\n\n$1');
      t = t.replace(/([.;])\n([A-ZÁÉÍÓÚÜÑ])/g,'$1\n\n$2');
      // Inline (dense text): spacing before numbered list items like " 1. La", " 2. El"
      t = t.replace(/ (\d{1,2})\. ([A-ZÁÉÍÓÚÜÑ])/g,'\n\n$1. $2');
      // Inline: spacing before "Artículo X" when preceded by a letter or punctuation
      t = t.replace(/([a-záéíóúüñA-ZÁÉÍÓÚÜÑ,.;:]) (Art[íi]culo\s+\d+)/gi,'$1\n\n$2');
      return escHtml(t).replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
    }

    // Try to locate the citation in the page text and show a focused context window
    // around it (±400 chars) with highlight. Fallback: full page text.
    // Try to locate the citation in the page text and show a focused context window
    // (±400 chars). No yellow highlight — unreliable due to paraphrasing differences.
    let html;
    let citaEncontrada = false;

    if(q.fragmento && q.fragmento.trim().length > 5){
      const words = q.fragmento.trim().split(/\s+/).slice(0, 8);
      if(words.length >= 2){
        try{
          const rx = new RegExp(
            words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
                 .join('[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]+'),
            'i'
          );
          const m = rx.exec(textoRaw);
          if(m){
            const CTX = 400;
            const start = Math.max(0, m.index - CTX);
            const end = Math.min(textoRaw.length, m.index + m[0].length + CTX);
            const pre  = (start > 0 ? '…' : '') + textoRaw.slice(start, m.index);
            const post = textoRaw.slice(m.index + m[0].length, end) + (end < textoRaw.length ? '…' : '');
            html = fmtEsc(pre)
                 + `<strong style="color:var(--navy);font-size:14px;">${escHtml(m[0]).replace(/\n/g,' ')}</strong>`
                 + fmtEsc(post);
            citaEncontrada = true;
          }
        } catch(rxErr){}
      }
    }
    if(!citaEncontrada) html = fmtEsc(textoRaw);

    const pdf = allPdfs.find(p=>p.id===currentQuizPdfId);
    const linkPdf = pdf?.urlPdf
      ? `<a href="${pdf.urlPdf}" target="_blank" style="font-size:12px;color:var(--blue-l);font-weight:600;">🔗 Abrir PDF completo ↗</a>`
      : '';

    const refHtml = q.referencia
      ? `<div style="font-size:11px;font-weight:700;color:#1d4ed8;background:#dbeafe;display:inline-block;padding:2px 8px;border-radius:4px;margin-bottom:6px;">📍 ${escHtml(q.referencia)}</div>`
      : '';
    const citaHtml = q.fragmento && q.fragmento.trim()
      ? `<div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:12px;">
           <div style="font-size:10px;font-weight:700;color:#93c5fd;letter-spacing:.8px;margin-bottom:6px;">📌 CITA DEL DOCUMENTO</div>
           ${refHtml}
           <div style="font-size:12px;font-style:italic;color:#1e40af;line-height:1.6;">"${escHtml(q.fragmento.trim())}"</div>
         </div>`
      : refHtml
        ? `<div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:12px;">${refHtml}</div>`
        : '';

    panel.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;font-weight:700;color:var(--navy);">📄 Página ${q.pagina||'?'}</span>
        ${linkPdf}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--navy);line-height:1.5;margin-bottom:10px;">${escHtml(q.pregunta||'')}</div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:9px 13px;margin-bottom:10px;font-size:12px;color:#92400e;">
        <strong>Respuesta correcta:</strong> ${escHtml(q.alternativas[q.correcta]||'')}
      </div>
      ${citaHtml}
      <div style="font-size:12.5px;line-height:1.9;color:var(--text);">${html}</div>`;
  } catch(e){
    panel.innerHTML='<div style="padding:20px;color:var(--red);">Error al cargar la página.</div>';
  }
}

// ══ PERFIL ════════════════════════════════════════════════
function loadPerfil(){
  db.ref(`${DB_PATH}/usuarios/${currentUser.uid}`).once('value', snap=>{
    const u = snap.val()||{};
    document.getElementById('perfil-nombre').textContent = u.nombre||'—';
    document.getElementById('perfil-email').textContent = currentUser.email;
    document.getElementById('perfil-avatar').textContent = (u.nombre||'?').charAt(0).toUpperCase();
    document.getElementById('perfil-fecha').textContent = fmtDate(u.fechaRegistro);
    document.getElementById('perfil-queries').textContent = u.consultas||0;
    const planEl = document.getElementById('perfil-plan');
    if(u.rol==='admin'){ planEl.textContent='Administrador'; planEl.className='badge badge-green'; }
    else if(u.plan==='activo'){ planEl.textContent='Miembro Activo'; planEl.className='badge badge-green'; }
    else { planEl.textContent='Inactivo'; planEl.className='badge badge-red'; }
  });
}

// ══ UTILS ════════════════════════════════════════════════
function fmtDate(iso){
  if(!iso) return '—';
  try {
    const d=new Date(iso);
    return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'});
  } catch(e){ return '—'; }
}
// ══ MODAL CONFIRMAR ═══════════════════════════════════════
let _modalOkFn = null;
function modalConfirm({ icon='🗑️', title='¿Eliminar?', msg='', okLabel='Eliminar', onOk }){
  document.getElementById('modal-confirm-icon').textContent = icon;
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-msg').innerHTML = msg;
  document.getElementById('modal-confirm-ok').textContent = okLabel;
  _modalOkFn = onOk;
  document.getElementById('modal-confirm').style.display='flex';
}
async function modalConfirmOk(){
  document.getElementById('modal-confirm').style.display='none';
  if(_modalOkFn) await _modalOkFn();
  _modalOkFn = null;
}
function modalConfirmCancel(){
  document.getElementById('modal-confirm').style.display='none';
  _modalOkFn = null;
}
// Cerrar al hacer clic fuera
document.getElementById('modal-confirm').addEventListener('click', function(e){ if(e.target===this) modalConfirmCancel(); });
document.getElementById('modal-confirm-ok').addEventListener('click', modalConfirmOk);

function showToast(msg, type=''){
  const t = document.getElementById('toast');
  t.textContent=msg;
  t.className='toast show'+(type?' '+type:'');
  setTimeout(()=>{ t.className='toast'; }, 3200);
}

// Particles animation in hero
(function initParticles(){
  const c = document.getElementById('particles-container');
  if(!c) return;
  const colors = ['rgba(59,130,246,.15)','rgba(245,158,11,.1)','rgba(16,185,129,.1)'];
  for(let i=0;i<18;i++){
    const el = document.createElement('div');
    el.className='particle';
    const size = 4 + Math.random()*12;
    el.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;top:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*6}s;animation-duration:${6+Math.random()*6}s;`;
    c.appendChild(el);
  }
})();

// ── Smooth scroll para nav links ──
document.querySelectorAll('.l-nav-links a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{
    e.preventDefault();
    document.querySelector(a.getAttribute('href'))?.scrollIntoView({behavior:'smooth'});
  });
});

// Enter en login/register
document.addEventListener('keydown',e=>{
  if(e.key==='Enter' && document.getElementById('modal-auth').classList.contains('open')){
    if(document.getElementById('form-login').style.display!=='none') doLogin();
    else doRegister();
  }
});
