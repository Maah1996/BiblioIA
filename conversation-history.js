/* The visible archive is independent from the current model conversation. */
let archiveOwner=null, archiveLoaded=false, archiveLoading=null, activeAssistantEntry=null;
const archiveEntries=new Map();
function normalizeArchiveText(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();}
function archiveMatches(record,query){return normalizeArchiveText([record.pregunta,record.respuesta,...(record.pdfs||[]),record.ley?.nombre].join(' ')).includes(normalizeArchiveText(query).trim());}
function assistantMessageTarget(){return activeAssistantEntry||document.getElementById('chat-messages');}
function createAssistantEntry(id,record){
  const section=document.createElement('article');section.className='assistant-entry';section.dataset.queryId=id;
  const label=document.createElement('div');label.className='assistant-entry-date';label.textContent=new Date(record.fecha).toLocaleString('es-CL');section.appendChild(label);
  return section;
}
function insertArchiveEntry(id,record){
  if(archiveEntries.has(id))return;
  const section=createAssistantEntry(id,record);
  const question=document.createElement('div');question.className='msg msg-user';question.textContent=record.pregunta||'Consulta';section.appendChild(question);
  if(record.imagenesAdjuntas){const note=document.createElement('small');note.textContent='Consulta con imagen adjunta (se conserva el texto de la consulta).';question.appendChild(document.createElement('br'));question.appendChild(note);}
  const answer=document.createElement('div');answer.className='msg msg-ai';
  if(record.respuesta)answer.innerHTML=formatAIResponse(record.respuesta);
  else answer.textContent='Esta consulta no tiene una respuesta guardada. Puedes volver a formularla.';
  section.appendChild(answer);
  archiveEntries.set(id,{record,section});document.getElementById('chat-messages').appendChild(section);
}
function sortAssistantArchive(){
  const container=document.getElementById('chat-messages');
  [...archiveEntries.entries()].sort((a,b)=>String(b[1].record.fecha).localeCompare(String(a[1].record.fecha))||b[0].localeCompare(a[0])).forEach(([,entry])=>container.appendChild(entry.section));
  if(activeAssistantEntry)container.prepend(activeAssistantEntry);
}
async function loadAssistantArchive(){
  if(!currentUser)return;
  const uid=currentUser.uid;
  if(archiveOwner!==uid)clearAssistantArchive(uid);
  if(archiveLoaded||archiveLoading)return archiveLoading;
  const status=document.getElementById('assistant-archive-status');status.textContent='Cargando consultas guardadas…';
  archiveLoading=(async()=>{
    try{
      const snapshot=await db.ref(`${DB_PATH}/consultas/${uid}`).once('value');
      if(archiveOwner!==uid)return;
      const container=document.getElementById('chat-messages');
      if(!archiveEntries.size)container.replaceChildren();
      Object.entries(snapshot.val()||{}).forEach(([id,record])=>insertArchiveEntry(id,record));
      archiveLoaded=true;sortAssistantArchive();filterAssistantArchive(document.getElementById('assistant-search').value);
    }catch(e){if(archiveOwner===uid){status.textContent='No se pudo cargar el historial. ';const retry=document.createElement('button');retry.textContent='Reintentar';retry.onclick=()=>loadAssistantArchive();status.appendChild(retry);}}
    finally{if(archiveOwner===uid)archiveLoading=null;}
  })();
  return archiveLoading;
}
function beginAssistantEntry(id,record){
  const container=document.getElementById('chat-messages');
  if(!archiveEntries.size)container.replaceChildren();
  activeAssistantEntry=createAssistantEntry(id,record);
  archiveEntries.set(id,{record,section:activeAssistantEntry});
  document.getElementById('assistant-search').value='';
  container.prepend(activeAssistantEntry);filterAssistantArchive('');container.scrollTop=0;
}
function markAssistantEntrySaved(id,record){const entry=archiveEntries.get(id);if(entry)entry.record={...record};filterAssistantArchive(document.getElementById('assistant-search').value);}
function offerAssistantSaveRetry(id,record,ref){
  const entry=archiveEntries.get(id);if(!entry)return;
  const button=document.createElement('button');button.className='btn-sm btn-gray';button.textContent='Reintentar guardado';
  button.onclick=async()=>{button.disabled=true;try{await ref.set(record);markAssistantEntrySaved(id,record);button.remove();}catch{showToast('No se pudo guardar. Revisa tu conexión.','red');}finally{button.disabled=false;}};
  entry.section.appendChild(button);
}
function finishAssistantEntry(){activeAssistantEntry=null;filterAssistantArchive(document.getElementById('assistant-search').value);}
function filterAssistantArchive(query){
  let count=0;archiveEntries.forEach(({record,section})=>{const visible=section===activeAssistantEntry||archiveMatches(record,query);section.hidden=!visible;if(visible)count++;});
  const status=document.getElementById('assistant-archive-status');
  status.textContent=archiveEntries.size?`${count} de ${archiveEntries.size} consultas · Más recientes arriba`: 'Tus preguntas y respuestas se conservarán aquí.';
  if(archiveEntries.size&&!count)status.textContent='No hay consultas que coincidan con la búsqueda.';
}
function clearAssistantArchive(uid=null){
  archiveOwner=uid;archiveLoaded=false;archiveLoading=null;activeAssistantEntry=null;archiveEntries.clear();
  document.getElementById('chat-messages').replaceChildren();document.getElementById('assistant-search').value='';
  filterAssistantArchive('');
}
if(auth)auth.onAuthStateChanged(user=>{chatHistory=[];assistantLaw=null;clearAssistantImages();clearAssistantArchive(user?.uid||null);if(user)loadAssistantArchive();});
