/* Formula rendering is local, escaped and shared by chat and saved history. */
function renderAssistantResponse(value){
  const formulas=[];
  const source=String(value??'').replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$])\$(?!\$)([^\n$]+?)\$(?!\$)/g,(raw,block,bracket,inline,dollar)=>{
    const tex=block??bracket??inline??dollar,display=block!==undefined||bracket!==undefined;
    let html;
    try{html=katex.renderToString(tex.trim(),{displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:20,output:'htmlAndMathml'});}
    catch{html=`<span class="formula-fallback">${escHtml(tex)}</span>`;}
    formulas.push(display?`<div class="math-equation">${html}</div>`:html);
    return `\uE000${formulas.length-1}\uE001`;
  });
  const inline=text=>_linkificarCitas(escHtml(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')).replace(/\uE000(\d+)\uE001/g,(_,i)=>formulas[Number(i)]||'');
  const lines=source.split('\n'),parts=[];let section=false;
  const close=()=>{if(section){parts.push('</section>');section=false;}};
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();if(!line)continue;
    const heading=line.match(/^#{1,4}\s+(.+)$/);
    if(heading){
      close();const title=heading[1];
      if(/^(?:Paso|Llave)\s*\d+\b|^(?:Resultado|Respuesta)\s+final/i.test(title)){
        const result=/^(Resultado|Respuesta)/i.test(title);
        parts.push(`<section class="solution-step${result?' solution-result':''}"><h4>${inline(title)}</h4>`);section=true;
      }else parts.push(`<h3 class="response-heading">${inline(title)}</h3>`);
    }else if(/^[-*_]{3,}$/.test(line)){close();}
    else if(line.includes('|')&&i+1<lines.length&&_esFilaSeparadoraTabla(lines[i+1])){
      const head=_partirFilaTabla(line);let rows='';i+=2;
      for(;i<lines.length&&lines[i].includes('|')&&lines[i].trim();i++)rows+='<tr>'+_partirFilaTabla(lines[i]).map(c=>`<td>${inline(c)}</td>`).join('')+'</tr>';
      i--;parts.push('<div class="ai-table-wrap"><table class="ai-table"><thead><tr>'+head.map(c=>`<th>${inline(c)}</th>`).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>');
    }else if(/^\uE000\d+\uE001$/.test(line)){
      const group=[inline(line)];let j=i+1;
      while(j<lines.length){const next=lines[j].trim();if(!next){j++;continue;}if(!/^\uE000\d+\uE001$/.test(next))break;group.push(inline(next));j++;}
      i=j-1;parts.push(group.length>1?'<div class="math-equation-group">'+group.join('')+'</div>':group[0]);
    }
    else parts.push(`<div class="response-paragraph">${inline(line)}</div>`);
  }
  close();return parts.join('');
}
