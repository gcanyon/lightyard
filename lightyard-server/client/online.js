/* ============================== ONLINE ============================== */
// Shared solutions, leaderboards, and community puzzles (see lightyard-server).
// With ONLINE_API_BASE empty, every online feature stays hidden.
const ONLINE_API_BASE='';
/*__ONLINE_SCHEMA_START__*/
// Shared by the browser and Worker. Call after the game's input validation.
// Only simulation configuration is allowed into online fingerprints or storage.
function canonicalOnlineElement(el) {
  const out={type:el.type,r:el.r,c:el.c};
  if(el.type==='emitter'||el.type==='receiver') {
    out.dirs=['N','E','S','W'].filter(d=>(el.dirs||[]).includes(d));out.colors=[...(el.colors||[])];
  } else if(el.type==='mirrorDiag') {
    out.orientation=el.orientation;out.switching=!!el.switching;
  } else if(el.type==='mirrorHalf') {
    out.facing=el.facing;out.seq=Array.from({length:3},(_,i)=>el.seq?.[i]??null);
  } else if(el.type==='prism') {
    out.base=el.base;out.seq=Array.from({length:3},(_,i)=>el.seq?.[i]??null);
  } else if(el.type==='crystal') {
    out.filterColor=el.filterColor??null;out.maxHits=el.maxHits??'inf';
  } else if(el.type==='transformer') out.direction=el.direction;
  if((el.type==='mirrorDiag'||el.type==='mirrorHalf')&&Number.isInteger(el.mirrorColor)&&el.mirrorColor>=1&&el.mirrorColor<=7)out.mirrorColor=el.mirrorColor;
  return out;
}
function canonicalOnlineLayout(elements) {
  return elements.map(canonicalOnlineElement).sort((a,b)=>a.r-b.r||a.c-b.c);
}
function canonicalOnlinePuzzle(p) {
  return {name:String(p.name||'Untitled Puzzle').slice(0,80),rows:p.rows,cols:p.cols,
    strict:!!p.strict,strictCrystals:!!p.strictCrystals,noCollisions:!!p.noCollisions,
    noPrisms:p.noPrisms!=null?!!p.noPrisms:!!p.mirrorsOnly,noHalfMirrors:!!p.noHalfMirrors,
    includeMirrorColors:!!p.includeMirrorColors,introText:String(p.introText||''),elements:canonicalOnlineLayout(p.elements||[])};
}

/*__ONLINE_SCHEMA_END__*/
const ONLINE_SITE_URL='https://www.geoffcanyon.com/lightyard.html';
const ONLINE_PIECE_NAMES={mirrorDiag:['mirror','mirrors'],mirrorHalf:['half-mirror','half-mirrors'],prism:['prism','prisms']};
class OnlineError extends Error{constructor(message,status){super(message);this.status=status;}}
function onlineApiBase(){
  let override=null;
  try{override=localStorage.getItem('lightyard_onlineApi');}catch(error){}
  return String(override||ONLINE_API_BASE||'').replace(/\/+$/,'');
}
function onlineEnabled(){return !!onlineApiBase();}
function onlineReadJson(kind,fallback){
  try{const raw=readStorage(kind);return raw?JSON.parse(raw):fallback;}catch(error){return fallback;}
}
function onlineObject(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function requireOnlineData(data,test){if(!test(data))throw new OnlineError('The server returned an incomplete response. Please try again later.',502);return data;}
function validOnlinePlayer(p){return onlineObject(p)&&typeof p.id==='string'&&typeof p.handle==='string'&&typeof p.displayName==='string';}
function validOnlineItem(p){return onlineObject(p)&&typeof p.id==='string'&&typeof p.player==='string'&&Array.isArray(p.layout)&&['solved','failed','unverified'].includes(p.status)&&Number.isInteger(p.elements)&&p.elements>=0&&p.layout.length===p.elements;}
function validOnlinePuzzle(p){if(!onlineObject(p))return false;try{sanitizePuzzleData(p,'online-validation');return true;}catch{return false;}}
function validOnlinePage(page,puzzles=false){return onlineObject(page)&&Array.isArray(page.items)&&page.items.every(puzzles?item=>onlineObject(item)&&typeof item.hash==='string'&&typeof item.name==='string':validOnlineItem)&&(puzzles?Number.isInteger(page.limit):Number.isInteger(page.total));}
async function onlineApi(method,path,body,{auth=false,timeout=20000}={}){
  const headers={};if(body!==undefined)headers['Content-Type']='application/json';
  if(auth){const token=readStorage('onlineToken');if(token)headers.Authorization='Bearer '+token;}
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeout):null;
  try{
    const response=await fetch(onlineApiBase()+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller?.signal});
    let data;try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw new OnlineError(response.ok?'The server returned an unreadable response. Please try again later.':`The server could not complete this request (${response.status}). Please try again later.`,response.status||502);}
    if(!response.ok)throw new OnlineError(typeof data?.error==='string'?data.error.slice(0,500):`The server could not complete this request (${response.status}).`,response.status);
    return requireOnlineData(data,onlineObject);
  }catch(error){if(error instanceof OnlineError)throw error;throw new OnlineError(error?.name==='AbortError'?'The Lightyard server took too long to answer.':'Couldn’t reach the Lightyard server. Check your connection and try again.',0);}
  finally{if(timer)clearTimeout(timer);}
}
function onlinePuzzleHash(puzzle){return puzzleConfigurationHash(canonicalOnlinePuzzle(puzzle));}

/* ---------- player ---------- */
// Everyone gets a generated name ("Amber Shimmer 7"). The Preferences player
// name is used online instead whenever the server's name filter accepts it.
let onlinePlayerPending=null;
async function createOnlinePlayer(){
  const created=requireOnlineData(await onlineApi('POST','/v1/players'),d=>typeof d.token==='string'&&/^[0-9a-f]{64}$/.test(d.token)&&validOnlinePlayer(d.player));
  if(!writeStorage('onlineToken',created.token))throw new OnlineError('Your browser could not save your online identity. Download a backup and resolve the storage warning before sharing.',0);
  writeStorage('onlinePlayer',JSON.stringify(created.player));writeStorage('onlineNameTried','\u0000');
  if(readStorage('onlinePublicName')===null)writeStorage('onlinePublicName',String(State.playerName||'').trim().slice(0,24));
}
async function ensureOnlinePlayer(){
  if(onlinePlayerPending)return onlinePlayerPending;
  onlinePlayerPending=(async()=>{
    if(!readStorage('onlineToken'))await createOnlinePlayer();
    try{return await syncOnlineName();}catch(error){
      if(error.status===401)throw new OnlineError('This browser’s online identity is no longer recognized. Your local puzzles are saved; please contact the game owner before creating a new identity.',401);
      throw error;
    }
  })();
  try{return await onlinePlayerPending;}finally{onlinePlayerPending=null;}
}
async function syncOnlineName(){
  let player=onlineReadJson('onlinePlayer',null);
  const wanted=String(readStorage('onlinePublicName')??player?.name??'').trim().slice(0,24);
  if(player&&(player.name||'')===wanted)return {player,nameNote:null};
  if(player&&readStorage('onlineNameTried')===wanted)return {player,nameNote:null};
  try{
    const result=requireOnlineData(await onlineApi('PUT','/v1/players/me/name',{name:wanted},{auth:true}),d=>validOnlinePlayer(d.player));
    player=result.player;writeStorage('onlinePlayer',JSON.stringify(player));writeStorage('onlineNameTried',wanted);return {player,nameNote:null};
  }catch(error){
    if(error.status!==422)throw error;writeStorage('onlineNameTried',wanted);
    return {player,nameNote:`Your public name can’t be used online (${error.message.replace(/\.$/,'')}), so you’re shown as ${player?.handle||'a generated name'}. Change it in Preferences › Online identity.`};
  }
}
function appendOnlineIdentitySettings(dialog){
  if(!onlineEnabled())return;
  const section=document.createElement('fieldset');section.className='online-identity-settings';
  const legend=document.createElement('legend');legend.textContent='Online identity';section.appendChild(legend);
  const status=document.createElement('p');status.className='online-identity-status';status.setAttribute('role','status');section.appendChild(status);
  const label=document.createElement('label');label.className='field';label.textContent='Public name (optional, 2–24 characters)';label.htmlFor='onlinePublicName';section.appendChild(label);
  const input=document.createElement('input');input.id='onlinePublicName';input.type='text';input.maxLength=24;input.value=readStorage('onlinePublicName')??onlineReadJson('onlinePlayer',null)?.name??String(State.playerName||'').slice(0,24);section.appendChild(input);
  const note=document.createElement('p');note.className='online-identity-note';note.textContent='Blank uses your generated name. Ownership is tied to this browser. Clearing browser data or using another device creates a separate identity.';section.appendChild(note);
  const actions=document.createElement('div');actions.className='online-identity-actions';section.appendChild(actions);
  const save=onlineSmallButton('Save public name','',async()=>{
    const name=input.value.trim();if(name.length===1){status.textContent='Use 2–24 characters, or leave the name blank.';return;}
    save.disabled=true;reroll.disabled=true;status.textContent='Saving public name…';
    try{await ensureOnlinePlayer();const r=requireOnlineData(await onlineApi('PUT','/v1/players/me/name',{name},{auth:true}),d=>validOnlinePlayer(d.player));writeStorage('onlinePublicName',name);writeStorage('onlineNameTried',name);writeStorage('onlinePlayer',JSON.stringify(r.player));renderStatus(r.player);}
    catch(e){status.textContent=e.message;}finally{save.disabled=false;reroll.disabled=false;}
  });
  const reroll=onlineSmallButton('New generated name','',async()=>{
    save.disabled=true;reroll.disabled=true;status.textContent='Changing generated name…';
    try{await ensureOnlinePlayer();const r=requireOnlineData(await onlineApi('POST','/v1/players/me/handle',undefined,{auth:true}),d=>validOnlinePlayer(d.player));writeStorage('onlinePlayer',JSON.stringify(r.player));renderStatus(r.player);}
    catch(e){status.textContent=e.message;}finally{save.disabled=false;reroll.disabled=false;}
  });
  actions.append(save,reroll);
  const renderStatus=player=>{status.textContent=player?`Public name: ${player.displayName}. Generated name: ${player.handle}.`:'You’ll receive an online identity when you first save a public name, upload a solution, or share a puzzle.';};
  renderStatus(onlineReadJson('onlinePlayer',null));
  dialog.insertBefore(section,dialog.querySelector('.rowbtns'));
  if(readStorage('onlineToken'))onlineApi('GET','/v1/players/me',undefined,{auth:true}).then(r=>{requireOnlineData(r,d=>validOnlinePlayer(d.player));writeStorage('onlinePlayer',JSON.stringify(r.player));if(section.isConnected)renderStatus(r.player);}).catch(e=>{if(section.isConnected)status.textContent=e.message;});
}

/* ---------- uploads ---------- */
function onlineLayoutSignature(elements){return stableStringify(canonicalOnlineLayout(elements||[]));}
function onlineUploadRecord(solution,puzzle=puzzleForSolution(solution)){
  if(!solution||solution.id==='BLANK'||!puzzle)return null;
  const record=onlineReadJson('onlineUploads',{})[solution.id];
  return record&&record.api===onlineApiBase()&&record.puzzleHash===onlinePuzzleHash(puzzle)&&record.sig===onlineLayoutSignature(solution.elements)?record:null;
}
function saveOnlineUploadRecord(solution,record){
  const all=onlineReadJson('onlineUploads',{});all[solution.id]=record;writeStorage('onlineUploads',JSON.stringify(all));
}
const onlineUploadPending=new Map(),onlineStatusPending=new Set();
async function refreshOnlineUploadRecord(puzzle,solution){
  const record=onlineUploadRecord(solution,puzzle);if(!record||onlineStatusPending.has(solution.id)||Date.now()-(record.refreshedAt||0)<300000)return;
  onlineStatusPending.add(solution.id);record.refreshedAt=Date.now();saveOnlineUploadRecord(solution,record);
  try{const item=requireOnlineData(await onlineApi('GET',`/v1/solutions/${record.code}`),validOnlineItem);
    if(onlineUploadRecord(solution,puzzle)?.code===record.code&&onlineUploadRecord(solution,puzzle)?.puzzleHash===record.puzzleHash){record.status=item.status;record.ticks=item.ticks;record.failure=item.failure;record.verificationNote=item.verificationNote;saveOnlineUploadRecord(solution,record);}
  }catch(e){if(e.status===404||e.status===410){record.status='unavailable';saveOnlineUploadRecord(solution,record);}}
  finally{onlineStatusPending.delete(solution.id);if(State.screen==='solutionEdit'&&getCurrentSolution()===solution)renderSolutionEditScreen();}
}
async function uploadSolutionOnline(puzzle,solution,onProgress){
  const elements=canonicalOnlineLayout(solution.elements||[]),puzzleHash=onlinePuzzleHash(puzzle),sig=onlineLayoutSignature(elements),api=onlineApiBase();
  const solved=solution.status==='solved',ticks=solved&&Number.isFinite(Number(solution.ticksToSolve))?Math.floor(Number(solution.ticksToSolve)):null;
  const key=api+':'+puzzleHash+':'+sig;
  if(onlineUploadPending.has(key))return onlineUploadPending.get(key);
  const job=(async()=>{
    const {nameNote}=await ensureOnlinePlayer();let upload;
    try{upload=requireOnlineData(await onlineApi('POST','/v1/solutions',{puzzleHash,elements,claimedSolved:solved,claimedTicks:ticks},{auth:true}),d=>/^[a-z0-9]{6}$/.test(d.id)&&['solved','failed','unverified'].includes(d.status));}
    catch(error){if(error.status===404)throw new OnlineError(puzzle._builtIn?'This puzzle isn’t on the online boards yet. Your copy may be out of date.':'Share this puzzle first (Create Puzzles › ⋮ › Share Puzzle Online), then upload your solution.',404);throw error;}
    const record={code:upload.id,status:'unverified',ticks:null,failure:null,sig,puzzleHash,api,at:Date.now(),refreshedAt:Date.now(),duplicate:!!upload.duplicate,yours:upload.yours!==false};
    saveOnlineUploadRecord(solution,record);if(onProgress)onProgress('Uploaded · checking…');
    try{
      const check=requireOnlineData(await onlineApi('POST',`/v1/solutions/${upload.id}/check`,undefined,{timeout:20000}),d=>['solved','failed','unverified'].includes(d.status)&&(d.status==='unverified'||Number.isFinite(d.ticks)));
      record.status=check.status;record.ticks=check.ticks??null;record.failure=check.failure||null;record.verificationNote=check.verificationNote||null;
    }catch(error){record.verificationNote=error.status===0?'The check did not complete before the connection ended.':`The server could not finish verification (${error.status}).`;}
    saveOnlineUploadRecord(solution,record);return {...record,nameNote};
  })();onlineUploadPending.set(key,job);
  try{return await job;}finally{onlineUploadPending.delete(key);}
}

function describeOnlineUpload(record){
  const lead=record.duplicate&&!record.yours?'Someone already uploaded this exact layout, so you’re listed as also finding it.'
    :record.duplicate?'You already uploaded this layout.':'Uploaded.';
  const result=record.status==='solved'?`Verified: it solves in ${record.ticks} tick${record.ticks===1?'':'s'}.`
    :record.status==='failed'?`It doesn’t solve the puzzle${record.failure?` (${record.failure.replace(/\.$/,'')})`:''}, so it’s listed with the attempts.`
    :`Your layout is saved and listed as unverified.${record.verificationNote?' '+record.verificationNote:''}`;
  return `${lead} ${result}${record.nameNote?' '+record.nameNote:''}`;
}
function onlineShareUrl(kind,id){
  const here=/^https?:$/.test(location.protocol)?location.origin+location.pathname:ONLINE_SITE_URL;
  return `${here}#${kind}=${id}`;
}
async function copyOnlineLink(url){
  try{await navigator.clipboard.writeText(url);showOnlineToast('Link copied.');}
  catch(error){window.prompt('Copy this link:',url);}
}
function showOnlineToast(message,actions=[],{sticky=false}={}){
  document.querySelectorAll('.online-toast').forEach(node=>node.remove());
  const toast=document.createElement('div');toast.className='clipboard-notice online-toast';toast.setAttribute('role','status');
  const text=document.createElement('span');text.textContent=message;toast.appendChild(text);
  for(const [label,action] of actions){
    const button=document.createElement('button');button.type='button';button.className='btn small';button.textContent=label;
    button.addEventListener('click',()=>{toast.remove();action();});toast.appendChild(button);
  }
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='btn small';dismiss.textContent='×';dismiss.setAttribute('aria-label','Dismiss');
  dismiss.addEventListener('click',()=>toast.remove());toast.appendChild(dismiss);
  document.body.appendChild(toast);
  if(!sticky)setTimeout(()=>toast.remove(),actions.length?15000:6000);
  return toast;
}
function onlineUploadActions(puzzle,record){
  return [['View board',()=>showOnlineBoard(puzzle)],['Copy link',()=>copyOnlineLink(onlineShareUrl('s',record.code))]];
}
async function uploadCurrentSolutionFromMenu(){
  const puzzle=getCurrentPuzzle();
  let solution=getCurrentSolution();
  if(!puzzle||!solution)return;
  if(solution.id==='BLANK'){
    if(!(solution.elements||[]).length&&solution.status!=='solved'){showOnlineToast('Run the puzzle first to confirm a zero-element solution.');return;}
    solution=promoteBlankIfNeeded();
  }
  const existing=onlineUploadRecord(solution,puzzle);
  if(existing){await refreshOnlineUploadRecord(puzzle,solution);const record=onlineUploadRecord(solution,puzzle)||existing;showOnlineToast(record.status==='unavailable'?'This uploaded layout is no longer available.':describeOnlineUpload(record),record.status==='unavailable'?[]:onlineUploadActions(puzzle,record));return;}
  if(solution.status!=='solved'&&!confirm('This solution hasn’t solved the puzzle yet. Upload it as an attempt? Attempts are listed separately from solutions.'))return;
  const progress=showOnlineToast('Uploading…',[],{sticky:true});
  try{
    const record=await uploadSolutionOnline(puzzle,solution,text=>{progress.querySelector('span').textContent=text;});
    showOnlineToast(describeOnlineUpload(record),onlineUploadActions(puzzle,record));
    if(State.screen==='solutionEdit'&&getCurrentSolution()===solution)renderSolutionEditScreen();
  }catch(error){showOnlineToast(error.message);}
}
// The upload button pair in the "Way to go!" dialog. Returns the button to focus.
function addCelebrationUploadButtons(dialog,close,puzzle,solution,nextPuzzle,goNext){
  const buttons=document.createElement('div');buttons.className='victory-buttons';
  close.className='btn solid';close.textContent=nextPuzzle?'Next Puzzle':'Continue';buttons.appendChild(close);
  const upload=document.createElement('button');upload.type='button';upload.className='btn victory-share';
  if(onlineUploadRecord(solution,puzzle)){
    upload.textContent='View uploaded solution';upload.addEventListener('click',()=>{dismissCelebration();showOnlineBoard(puzzle);});
  }else{
    upload.textContent=nextPuzzle?'Share solution & continue':'Share solution';
    upload.addEventListener('click',event=>{
      event.stopPropagation();upload.disabled=true;
      // Start the saved-layout upload, then let the player continue immediately.
      const progress=showOnlineToast('Sharing solution…',[],{sticky:true});
      const job=uploadSolutionOnline(puzzle,solution,text=>{const span=progress.querySelector('span');if(span)span.textContent=text;});
      if(nextPuzzle)goNext();else dismissCelebration();
      job.then(record=>showOnlineToast(describeOnlineUpload(record),onlineUploadActions(puzzle,record)))
        .catch(error=>showOnlineToast(`Couldn’t share “${puzzle.name}”: ${error.message} Your solution is saved locally.`,[['Open solution',()=>openPuzzleBoard(puzzle,solution.id)]]));
    });
  }
  buttons.appendChild(upload);dialog.appendChild(buttons);return close;
}

/* ---------- puzzles ---------- */
function onlinePuzzleByHash(hash){
  return allPuzzles().find(p=>onlinePuzzleHash(p)===hash||puzzleConfigurationHash(p)===hash)||null;
}
function communitySetId(){
  let set=State.sets.find(s=>s.name==='Community');
  if(!set){set={id:uid(),name:'Community',createdAt:Date.now()};State.sets.push(set);}
  return set.id;
}
function findOrImportOnlinePuzzle(hash,rawPuzzle){
  if(!validOnlinePuzzle(rawPuzzle))throw new OnlineError('The server returned an invalid puzzle.',502);
  const existing=onlinePuzzleByHash(onlinePuzzleHash(rawPuzzle))||onlinePuzzleByHash(hash);
  if(existing)return existing;
  const previousSets=State.sets.slice();
  const puzzle=sanitizePuzzleData(rawPuzzle,communitySetId());
  State.puzzles.push(puzzle);if(!persistData()){State.puzzles.pop();State.sets=previousSets;throw new OnlineError('The puzzle could not be saved. Resolve the browser storage warning before importing.',0);}
  return puzzle;
}
function loadOnlineSolution(puzzle,item){
  requireOnlineData(item,validOnlineItem);
  const browsing=State.screen==='online';rememberOnlinePosition();
  puzzle=findOrImportOnlinePuzzle(item.puzzleHash||onlinePuzzleHash(puzzle),puzzle);
  const api=onlineApiBase(),sig=onlineLayoutSignature(item.layout);
  let solution=solutionsForPuzzle(puzzle).find(s=>s.status!=='solved'&&s.onlineSource?.api===api&&s.onlineSource?.solutionId===item.id&&onlineLayoutSignature(s.elements)===sig);
  if(!solution){
    const label=`${item.player} · ${item.elements} element${item.elements===1?'':'s'}`;
    solution=sanitizeSolutionData({name:label.slice(0,80),elements:item.layout,status:'in-progress'},puzzle);
    solution.onlineSource={api,solutionId:item.id,puzzleHash:item.puzzleHash||onlinePuzzleHash(puzzle),player:item.player,playerId:item.playerId||null,importedAt:Date.now()};
    State.solutions.push(solution);if(!persistSolutions()){State.solutions.pop();throw new OnlineError('The solution could not be saved. Resolve the browser storage warning before importing.',0);}
  }
  if(browsing)onlineReturnContext={puzzleId:puzzle.id};
  closeOnlineDialogs();setActiveMode('solve');openPuzzleBoard(puzzle,solution.id);
  showOnlineToast(`Opened ${item.player}’s layout as an editable attempt. A successful local replay will mark it solved.`);
}
async function shareCurrentPuzzle(puzzle){
  if(!puzzle)return;
  if(!confirm(`Share “${puzzle.name}” online? Anyone will be able to play it, and it will be listed as unsolved until someone solves it. Changing its pieces or rules creates a separate online puzzle. You can update this copy’s name and introduction while using this browser identity.`))return;
  const progress=showOnlineToast('Sharing…',[],{sticky:true});
  try{
    const {nameNote}=await ensureOnlinePlayer();
    const shared=canonicalOnlinePuzzle(puzzle);
    const result=requireOnlineData(await onlineApi('POST','/v1/puzzles',{puzzle:shared},{auth:true}),d=>typeof d.hash==='string');
    const lead=!result.existing?'Shared! It’s in the Online list now.'
      :result.source==='builtin'?'That puzzle matches a built-in puzzle, so it already has an online board.'
      :result.updated?'Shared puzzle name and introduction updated.':'That configuration was already shared. Its existing online name and introduction are kept.';
    showOnlineToast(lead+(nameNote?' '+nameNote:''),[['Copy link',()=>copyOnlineLink(onlineShareUrl('p',result.hash))],['View board',()=>showOnlineBoard(puzzle)]]);
  }catch(error){showOnlineToast(error.message);}
  finally{progress.remove();}
}
function onlineSolutionMenuItems(){return onlineEnabled()?[['uploadSolution','Upload Solution'],['onlineBoard','Online Solutions']]:[];}
function onlinePuzzleMenuItems(p){return onlineEnabled()&&p&&!p._builtIn?[['sharePuzzle','Share Puzzle Online'],['onlineBoard','Online Solutions']]:[];}
function addOnlineBadge(container,puzzle,solution){
  const record=onlineEnabled()?onlineUploadRecord(solution,puzzle):null;
  if(!record)return;
  const badge=document.createElement('span');badge.className='badge online-badge';
  badge.textContent={unverified:'Uploaded · unverified',failed:'Uploaded · failed',solved:'Uploaded · verified',unavailable:'Upload unavailable'}[record.status]||'Uploaded';
  badge.title='Show the online board';badge.addEventListener('click',()=>showOnlineBoard(puzzle));
  container.appendChild(badge);
  refreshOnlineUploadRecord(puzzle,solution);
}

/* ---------- thumbnails ---------- */
function drawOnlineThumb(canvas,puzzle,layout,size){
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=size*dpr;canvas.height=size*dpr;
  const g=canvas.getContext('2d');if(!g)return;
  g.scale(dpr,dpr);
  const rows=puzzle.rows||7,cols=puzzle.cols||7;
  const cell=Math.floor((size-4)/Math.max(rows,cols));
  const ox=Math.floor((size-cell*cols)/2),oy=Math.floor((size-cell*rows)/2);
  g.fillStyle='#0a0b10';g.fillRect(0,0,size,size);
  g.strokeStyle='#1c1f29';g.lineWidth=1;
  for(let r=0;r<=rows;r++){g.beginPath();g.moveTo(ox,oy+r*cell+.5);g.lineTo(ox+cols*cell,oy+r*cell+.5);g.stroke();}
  for(let c=0;c<=cols;c++){g.beginPath();g.moveTo(ox+c*cell+.5,oy);g.lineTo(ox+c*cell+.5,oy+rows*cell);g.stroke();}
  const color=v=>v==='black'?'#101319':COLHEX[v]||'#8b8fa3';
  const draw=(el,player)=>{
    const x=ox+el.c*cell,y=oy+el.r*cell,cx=x+cell/2,cy=y+cell/2,h=cell*.36;
    g.lineWidth=Math.max(1.2,cell*.12);g.lineCap='round';
    if(el.type==='emitter'){g.fillStyle=color((el.colors||[])[0]);g.fillRect(x+cell*.2,y+cell*.2,cell*.6,cell*.6);}
    else if(el.type==='receiver'){g.strokeStyle=color((el.colors||[])[0]);g.lineWidth=Math.max(1.2,cell*.1);g.strokeRect(x+cell*.22,y+cell*.22,cell*.56,cell*.56);}
    else if(el.type==='crystal'){g.fillStyle=el.filterColor==null?'#cfd3e055':color(el.filterColor);g.strokeStyle='#9ba7b5';g.lineWidth=Math.max(1,cell*.035);g.beginPath();g.moveTo(cx,cy-h);g.lineTo(cx+h,cy);g.lineTo(cx,cy+h);g.lineTo(cx-h,cy);g.closePath();g.fill();g.stroke();if(cell>20&&el.maxHits!=null&&el.maxHits!=='inf'){g.fillStyle=el.filterColor==='black'?'#ddd':'#fff';g.font=`bold ${Math.round(cell*.25)}px sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(String(el.maxHits),cx,cy);}}
    else if(el.type==='transformer'){g.strokeStyle='#cfd3e0';g.beginPath();g.arc(cx,cy,h*.8,0,Math.PI*2);g.stroke();if(cell>14){g.fillStyle='#d0d5de';g.font=`bold ${Math.round(cell*.55)}px sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(el.direction==='down'?'↓':'↑',cx,cy);}}
    else{
      g.strokeStyle=mirrorColorFor(el)!=null?color(mirrorColorFor(el)):player?'#6ee7ff':'#cfd3e0';g.fillStyle=g.strokeStyle;
      if(el.type==='mirrorDiag'){
        g.beginPath();
        if(el.orientation==='NE_SW'){g.moveTo(cx-h,cy+h);g.lineTo(cx+h,cy-h);}else{g.moveTo(cx-h,cy-h);g.lineTo(cx+h,cy+h);}
        g.stroke();
      }else if(el.type==='mirrorHalf'){
        drawHalfMirrorLines(g,cx,cy,cell*.72,halfMirrorFacing(el),mirrorColorFor(el));
      }else if(el.type==='prism'){
        drawPrismBody(g,cx,cy,cell*.65,el.base||'E');
      }

    }
  };
  const drawQueue=el=>{
    if(cell<18||!['emitter','receiver'].includes(el.type))return;
    g.strokeStyle='#e4e8f1';g.lineWidth=Math.max(1,cell*.04);
    for(const dir of el.dirs||[]){const [dx,dy]={N:[0,-1],E:[1,0],S:[0,1],W:[-1,0]}[dir]||[0,0];
      const cx=ox+(el.c+.5)*cell,cy=oy+(el.r+.5)*cell,receiver=el.type==='receiver',x=cx+dx*cell*(receiver?.25:.38),y=cy+dy*cell*(receiver?.25:.38),vx=receiver?-dx:dx,vy=receiver?-dy:dy;
      g.beginPath();g.moveTo(x-vx*cell*.1-vy*cell*.08,y-vy*cell*.1+vx*cell*.08);g.lineTo(x,y);g.lineTo(x-vx*cell*.1+vy*cell*.08,y-vy*cell*.1-vx*cell*.08);g.stroke();}
    const colors=el.colors||[],dot=Math.min(cell*.1,4),width=Math.min(5,colors.length)*(dot*2+1);
    for(let i=0;i<colors.length;i++){g.fillStyle=color(colors[i]);g.beginPath();g.arc(ox+(el.c+.5)*cell-width/2+(i%5)*(dot*2+1)+dot,oy+(el.r+.73)*cell+Math.floor(i/5)*(dot*2+1),dot,0,Math.PI*2);g.fill();}
  };
  for(const el of puzzle.elements||[]){draw(el,false);drawQueue(el);}
  for(const el of layout||[])draw(el,true);
}
function makeOnlineThumb(puzzle,layout,size){
  const canvas=document.createElement('canvas');canvas.style.width=size+'px';canvas.style.height=size+'px';
  drawOnlineThumb(canvas,puzzle,layout,size);return canvas;
}

/* ---------- dialogs ---------- */
function closeOnlineDialogs(){
  document.querySelectorAll('.online-backdrop').forEach(node=>{if(node._onKey)document.removeEventListener('keydown',node._onKey,true);node.remove();});
}
function onlineSelect(options,value,onChange){
  const select=document.createElement('select');
  for(const [v,label] of options){const o=document.createElement('option');o.value=v;o.textContent=label;select.appendChild(o);}
  select.value=value;select.addEventListener('change',()=>onChange(select.value));return select;
}
function onlineTabs(options,value,onChange){
  const wrap=document.createElement('div');wrap.className='online-tabs';
  for(const [v,label] of options){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.classList.toggle('active',v===value);
    b.addEventListener('click',()=>{wrap.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));onChange(v);});
    wrap.appendChild(b);
  }
  return wrap;
}
function onlinePieceSummary(item){
  const parts=Object.entries(item.byType||{}).sort((a,b)=>b[1]-a[1]).map(([type,n])=>{
    const names=ONLINE_PIECE_NAMES[type]||[type,type+'s'];return `${n} ${n===1?names[0]:names[1]}`;
  });
  return `${item.elements} element${item.elements===1?'':'s'}${parts.length>1?` (${parts.join(', ')})`:''}`;
}
function onlineTicksText(item){
  if(item.verified&&item.ticks!=null)return `${item.ticks} tick${item.ticks===1?'':'s'}`;
  return item.claimedTicks!=null?`${item.claimedTicks} ticks claimed`:'';
}
function onlineDate(ms){
  try{return new Date(ms).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(error){return '';}
}
function onlineTag(text,kind){const t=document.createElement('span');t.className='online-tag'+(kind?' '+kind:'');t.textContent=text;return t;}
function onlineEmpty(text){const e=document.createElement('div');e.className='online-empty';e.textContent=text;return e;}
function onlineSmallButton(label,title,onClick){
  const b=document.createElement('button');b.type='button';b.className='btn small';b.textContent=label;if(title)b.title=title;
  b.addEventListener('click',async event=>{if(b.disabled)return;try{const result=onClick(event);if(result&&typeof result.then==='function'){b.disabled=true;await result;}}catch(error){showOnlineToast(error.message||'This action could not be completed.');}finally{b.disabled=false;}});return b;
}

// Full-page catalog and spoiler-safe puzzle details. Page state is session-only.
const onlineBrowse={source:'all',sort:'newest',query:'',items:[],offset:0,hasMore:false,loaded:false,signature:'',scroll:0,detail:null,renderId:0};
const onlinePuzzleCache=new Map();
let onlineReturnContext=null;
function rememberOnlinePosition(){
  if(State.screen!=='online')return;
  if(onlineBrowse.detail)onlineBrowse.detail.scroll=leftPanel.scrollTop;else onlineBrowse.scroll=leftPanel.scrollTop;
}
function showOnlineHub({restoreDetail=false}={}){
  if(!onlineEnabled())return;
  saveCurrentSolutionBeforeLeaving();if(!restoreDetail)rememberOnlinePosition();closeOnlineDialogs();
  if(!restoreDetail)onlineBrowse.detail=null;
  setActiveMode('online');State.screen='online';State.currentPuzzleId=null;State.currentSolutionId=null;
  State.selectedTool=null;State.selectedCell=null;renderScreen();
}
function returnToOnlinePage(){
  if(!onlineReturnContext||onlineReturnContext.puzzleId!==State.currentPuzzleId)return false;
  onlineReturnContext=null;showOnlineHub({restoreDetail:true});return true;
}
function openOnlinePuzzleDetail(item,{reveal=false}={}){
  rememberOnlinePosition();
  onlineBrowse.detail={hash:item.hash,revealed:reveal,scroll:0,solutions:{query:'',sort:'pieces',view:'solutions',items:[],offset:0,total:0,loaded:false,highlights:{},generation:0}};
  showOnlineHub({restoreDetail:true});
}
// Menu and upload actions explicitly request solutions; catalog details do not.
function showOnlineBoard(puzzle){if(puzzle)openOnlinePuzzleDetail({hash:onlinePuzzleHash(puzzle)},{reveal:true});}
async function onlinePuzzleDetails(hash){
  const cached=onlinePuzzleCache.get(hash);
  if(cached&&Date.now()-cached.at<120000)return cached.promise;
  const promise=onlineApi('GET',`/v1/puzzles/${hash}`).then(d=>requireOnlineData(d,x=>typeof x.hash==='string'&&validOnlinePuzzle(x.puzzle)));
  const entry={at:Date.now(),promise};onlinePuzzleCache.set(hash,entry);
  if(onlinePuzzleCache.size>30)onlinePuzzleCache.delete(onlinePuzzleCache.keys().next().value);
  try{return await promise;}catch(e){if(onlinePuzzleCache.get(hash)===entry)onlinePuzzleCache.delete(hash);throw e;}
}
function onlineSearch(label,value,onChange){
  const input=document.createElement('input');input.type='search';input.maxLength=80;input.placeholder=label;input.value=value;input.setAttribute('aria-label',label);
  let timer=null;
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(input.isConnected)onChange(input.value.trim());},300);});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(timer);onChange(input.value.trim());}});
  return input;
}
function onlineLabeledSelect(label,options,value,onChange){
  const wrap=document.createElement('label');wrap.className='online-filter';
  const text=document.createElement('span');text.textContent=label;wrap.appendChild(text);
  const select=onlineSelect(options,value,onChange);select.setAttribute('aria-label',label);wrap.appendChild(select);return wrap;
}
function onlineStats(item){
  const stats=document.createElement('div');stats.className='online-stats';
  for(const [label,value] of [['Verified solutions',item.solutionCount??0],['Fewest elements',item.bestElements??'—'],['Fewest ticks',item.bestTicks??'—']]){
    const cell=document.createElement('div'),number=document.createElement('strong'),caption=document.createElement('span');number.textContent=String(value);caption.textContent=label;cell.append(number,caption);stats.appendChild(cell);
  }
  return stats;
}
function onlinePuzzleCaption(item){return [item.source==='builtin'?'Built-in':'Community',item.set,item.author?`by ${item.author}`:null].filter(Boolean).join(' · ');}
function renderOnlinePage(){
  const host=document.createElement('section');host.className='online-page';host.setAttribute('aria-label','Online Puzzles');
  leftPanel.replaceChildren(host);const id=++onlineBrowse.renderId;
  if(onlineBrowse.detail)renderOnlinePuzzleDetail(host,id,onlineBrowse.detail);else renderOnlineCatalog(host,id);
}
function onlinePageCurrent(host,id){return host.isConnected&&State.screen==='online'&&id===onlineBrowse.renderId;}
function renderOnlineCatalog(host,id){
  const heading=document.createElement('h2');heading.textContent='Online Puzzles';host.appendChild(heading);
  const note=document.createElement('p');note.className='online-page-note';note.textContent='Browse built-in and community puzzles. Open a puzzle for a closer look; solutions stay hidden until you ask.';host.appendChild(note);
  const controls=document.createElement('div');controls.className='online-controls online-catalog-controls';
  const search=onlineSearch('Search puzzles, sets, or creators',onlineBrowse.query,v=>{onlineBrowse.query=v;reload();});controls.appendChild(search);
  controls.appendChild(onlineLabeledSelect('Source',[['all','All puzzles'],['builtin','Built-in'],['shared','Community']],onlineBrowse.source,v=>{onlineBrowse.source=v;reload();}));
  controls.appendChild(onlineLabeledSelect('Sort',[['newest','Newest'],['name','Name'],['solutions','Most solutions'],['unsolved','Unsolved first'],['recently_solved','Recently solved']],onlineBrowse.sort,v=>{onlineBrowse.sort=v;reload();}));
  const refresh=onlineSmallButton('Refresh','Refresh online puzzles',()=>reload());controls.appendChild(refresh);host.appendChild(controls);
  const status=document.createElement('p');status.className='online-page-note';status.setAttribute('role','status');host.appendChild(status);
  const list=document.createElement('div');list.className='online-catalog-list';host.appendChild(list);
  const more=onlineSmallButton('Load more puzzles','',()=>loadMore());more.classList.add('online-more');host.appendChild(more);
  let generation=0,loading=false;
  const signature=()=>JSON.stringify([onlineBrowse.source,onlineBrowse.sort,onlineBrowse.query]);
  function draw(){
    list.replaceChildren();for(const item of onlineBrowse.items){
      const row=document.createElement('article');row.className='online-catalog-row';
      const open=document.createElement('button');open.type='button';open.className='online-puzzle-open';open.setAttribute('aria-label',`View ${item.name}`);
      if(item.preview&&validOnlinePuzzle({...item.preview,name:item.name}))open.appendChild(makeOnlineThumb(item.preview,[],88));
      const info=document.createElement('div');info.className='online-puzzle-info';const title=document.createElement('h3');title.textContent=item.name;
      const caption=document.createElement('p');caption.textContent=onlinePuzzleCaption(item);info.append(title,caption);open.appendChild(info);open.addEventListener('click',()=>openOnlinePuzzleDetail(item));row.appendChild(open);
      row.appendChild(onlineStats(item));const details=onlineSmallButton('View puzzle','Preview puzzle without revealing solutions',()=>openOnlinePuzzleDetail(item));details.classList.add('online-view-puzzle');row.appendChild(details);list.appendChild(row);
    }
    if(!onlineBrowse.items.length)list.appendChild(onlineEmpty(onlineBrowse.query?'No puzzles match that search.':'No puzzles in this category yet.'));
    status.textContent=`${onlineBrowse.items.length} puzzle${onlineBrowse.items.length===1?'':'s'}${onlineBrowse.hasMore?' loaded':''}`;
    more.hidden=!onlineBrowse.hasMore;more.disabled=loading;
  }
  async function fetchPage(offset){const q=new URLSearchParams({source:onlineBrowse.source,sort:onlineBrowse.sort,q:onlineBrowse.query,limit:'30',offset:String(offset)});return requireOnlineData(await onlineApi('GET','/v1/puzzles?'+q),d=>validOnlinePage(d,true));}
  async function reload(){
    const g=++generation;loading=true;more.hidden=true;refresh.disabled=true;status.textContent='Loading puzzles…';list.replaceChildren();
    onlineBrowse.loaded=false;onlineBrowse.scroll=0;
    try{const page=await fetchPage(0);if(!onlinePageCurrent(host,id)||g!==generation)return;
      onlineBrowse.items=page.items;onlineBrowse.offset=page.items.length;onlineBrowse.hasMore=page.hasMore===true;onlineBrowse.signature=signature();onlineBrowse.loaded=true;draw();
    }catch(e){if(onlinePageCurrent(host,id)&&g===generation){status.textContent=e.message;list.replaceChildren(onlineSmallButton('Try again','Retry loading puzzles',reload));}}
    finally{if(onlinePageCurrent(host,id)&&g===generation){loading=false;refresh.disabled=false;more.disabled=false;}}
  }
  async function loadMore(){
    if(loading)return;loading=true;const g=generation;more.disabled=true;
    try{const page=await fetchPage(onlineBrowse.offset);if(!onlinePageCurrent(host,id)||g!==generation)return;
      const seen=new Set(onlineBrowse.items.map(x=>x.hash));onlineBrowse.items.push(...page.items.filter(x=>!seen.has(x.hash)));onlineBrowse.offset+=page.items.length;onlineBrowse.hasMore=page.hasMore===true;draw();
    }catch(e){if(onlinePageCurrent(host,id)&&g===generation)status.textContent=e.message;}
    finally{if(onlinePageCurrent(host,id)&&g===generation){loading=false;more.disabled=false;}}
  }
  if(onlineBrowse.loaded&&onlineBrowse.signature===signature()){draw();leftPanel.scrollTop=onlineBrowse.scroll;}else reload();
}
async function renderOnlinePuzzleDetail(host,id,detail){
  const back=onlineSmallButton('← Online Puzzles','Back to puzzle list',()=>showOnlineHub());back.classList.add('online-back');host.appendChild(back);
  const content=document.createElement('div');host.appendChild(content);content.appendChild(onlineEmpty('Loading puzzle…'));
  let data;
  try{data=await onlinePuzzleDetails(detail.hash);if(!onlinePageCurrent(host,id)||onlineBrowse.detail!==detail)return;}
  catch(e){if(onlinePageCurrent(host,id)){content.replaceChildren(onlineEmpty(e.message));content.appendChild(onlineSmallButton('Try again','',()=>renderOnlinePage()));}return;}
  detail.hash=data.hash;detail.data=data;content.replaceChildren();
  const heading=document.createElement('h2');heading.textContent=data.name;content.appendChild(heading);
  const caption=document.createElement('p');caption.className='online-page-note';caption.textContent=onlinePuzzleCaption(data);content.appendChild(caption);
  const top=document.createElement('div');top.className='online-detail-top';content.appendChild(top);
  const preview=makeOnlineThumb(data.puzzle,[],320);preview.className='online-detail-preview';preview.setAttribute('role','img');preview.setAttribute('aria-label',`Puzzle preview: ${data.puzzle.rows} rows and ${data.puzzle.cols} columns, fixed elements only`);top.appendChild(preview);
  const summary=document.createElement('div');summary.className='online-detail-summary';top.appendChild(summary);summary.appendChild(onlineStats(data));
  const dims=document.createElement('p');dims.className='online-page-note';dims.textContent=`${data.puzzle.rows} rows × ${data.puzzle.cols} columns${data.attemptCount?` · ${data.attemptCount} uploaded attempt${data.attemptCount===1?'':'s'}`:''}`;summary.appendChild(dims);
  const rules=document.createElement('div');rules.className='online-detail-rules';appendPuzzleRuleIndicators(rules,data.puzzle);if(rules.children.length)summary.appendChild(rules);
  const actions=document.createElement('div');actions.className='online-detail-actions';summary.appendChild(actions);
  const tryIt=onlineSmallButton('Try It','Open a new local attempt without revealing solutions',()=>{
    const puzzle=findOrImportOnlinePuzzle(data.hash,data.puzzle);onlineReturnContext={puzzleId:puzzle.id};rememberOnlinePosition();setActiveMode('solve');openPuzzleBoard(puzzle,'BLANK');
  });tryIt.classList.add('solid');actions.appendChild(tryIt);
  const reveal=onlineSmallButton(detail.revealed?'Hide Solutions':'Show Solutions','Reveal uploaded layouts',()=>{
    detail.revealed=!detail.revealed;reveal.textContent=detail.revealed?'Hide Solutions':'Show Solutions';reveal.setAttribute('aria-expanded',String(detail.revealed));solutions.hidden=!detail.revealed;
    if(detail.revealed&&!solutions.childElementCount)renderOnlineSolutions(solutions,id,detail,data);
  });reveal.setAttribute('aria-expanded',String(detail.revealed));reveal.setAttribute('aria-controls','onlineSolutions');actions.appendChild(reveal);
  actions.appendChild(onlineSmallButton('Copy puzzle link','',()=>copyOnlineLink(onlineShareUrl('p',data.hash))));
  const hint=document.createElement('p');hint.className='online-page-note';hint.textContent='Try It starts a new attempt. Show Solutions reveals other players’ layouts.';summary.appendChild(hint);
  if(data.puzzle.introText){const intro=document.createElement('div');intro.className='online-detail-intro puzzle-intro-surface';renderPuzzleIntroText(intro,data.puzzle.introText);content.appendChild(intro);}
  const solutions=document.createElement('section');solutions.id='onlineSolutions';solutions.className='online-detail-solutions';solutions.hidden=!detail.revealed;solutions.setAttribute('aria-label','Uploaded solutions');content.appendChild(solutions);
  if(detail.revealed)renderOnlineSolutions(solutions,id,detail,data);
  leftPanel.scrollTop=detail.scroll;
}
function renderOnlineSolutions(host,id,detail,data){
  const state=detail.solutions;
  const controls=document.createElement('div');controls.className='online-controls';host.appendChild(controls);
  controls.appendChild(onlineTabs([['solutions','Solutions'],['attempts','Attempts']],state.view,v=>{state.view=v;reload();}));
  controls.appendChild(onlineSearch('Search player names',state.query,v=>{state.query=v;reload();}));
  controls.appendChild(onlineLabeledSelect('Solution sort',[['pieces','Fewest elements'],['ticks','Fewest ticks'],['ticks_desc','Most ticks'],['oldest','First submitted'],['newest','Newest']],state.sort,v=>{state.sort=v;reload();}));
  const note=document.createElement('p');note.className='online-page-note';note.textContent='Opened layouts become editable local attempts. A successful local replay marks them solved and locks them.';host.appendChild(note);
  const status=document.createElement('p');status.className='online-page-note';status.setAttribute('role','status');host.appendChild(status);
  const highlights=document.createElement('div');highlights.className='online-highlights';host.appendChild(highlights);
  const list=document.createElement('div');list.className='online-list';host.appendChild(list);
  const more=onlineSmallButton('Load more solutions','',()=>loadMore());more.classList.add('online-more');host.appendChild(more);
  let loading=false;const signature=()=>JSON.stringify([state.view,state.sort,state.query]);
  function open(item){rememberOnlinePosition();loadOnlineSolution(data.puzzle,item);}
  function draw(){
    highlights.replaceChildren();list.replaceChildren();
    const grouped=new Map();
    if(state.view==='solutions'&&!state.query)for(const [key,label] of [['fewestPieces','Fewest elements'],['fewestTicks','Fewest ticks'],['mostTicks','Most ticks'],['first','First solved'],['newest','Newest']]){
      const item=state.highlights[key];if(!item)continue;requireOnlineData(item,validOnlineItem);if(!grouped.has(item.id))grouped.set(item.id,{item,labels:[]});grouped.get(item.id).labels.push(label);
    }
    for(const {item,labels} of grouped.values()){
      const card=document.createElement('div');card.className='online-card';const label=document.createElement('div');label.className='label';label.textContent=labels.join(' · ');card.append(label,makeOnlineThumb(data.puzzle,item.layout,120));
      const who=document.createElement('div');who.className='who';who.textContent=item.player;const meta=document.createElement('div');meta.className='meta';meta.textContent=`${item.elements} elements · ${onlineTicksText(item)}`;card.append(who,meta,onlineSmallButton('Open','Copy this layout into an editable local attempt',()=>open(item)));highlights.appendChild(card);
    }
    for(const item of state.items){
      const row=document.createElement('article');row.className='online-row';row.appendChild(makeOnlineThumb(data.puzzle,item.layout,72));
      const info=document.createElement('div');info.className='info';const who=document.createElement('div');who.className='who';who.textContent=item.player;who.appendChild(onlineTag(item.status==='unverified'?'Unverified':item.status==='solved'?'Verified':'Failed',item.status==='solved'?'good':'warn'));
      if(item.alsoFoundBy)who.appendChild(onlineTag(`also found by ${item.alsoFoundBy}`));
      const meta=document.createElement('div');meta.className='meta';meta.textContent=[onlinePieceSummary(item),onlineTicksText(item),state.view==='attempts'?item.failure:null,onlineDate(item.submittedAt)].filter(Boolean).join(' · ');info.append(who,meta);row.appendChild(info);
      const actions=document.createElement('div');actions.className='actions';actions.append(onlineSmallButton('Open','Copy this layout into an editable local attempt',()=>open(item)),onlineSmallButton('Copy link','',()=>copyOnlineLink(onlineShareUrl('s',item.id))));row.appendChild(actions);list.appendChild(row);
    }
    if(!state.items.length)list.appendChild(onlineEmpty(state.query?'No players match that search.':state.view==='solutions'?'No solutions uploaded yet.':'No attempts uploaded yet.'));
    status.textContent=`${state.total} ${state.view==='solutions'?'solution':'attempt'}${state.total===1?'':'s'}${state.query?' matching':''}`;more.hidden=state.offset>=state.total;
  }
  const current=g=>onlinePageCurrent(host,id)&&onlineBrowse.detail===detail&&g===state.generation;
  async function fetchPage(offset){const q=new URLSearchParams({view:state.view,sort:state.sort,q:state.query,limit:'30',offset:String(offset)});return requireOnlineData(await onlineApi('GET',`/v1/puzzles/${data.hash}/solutions?`+q),d=>validOnlinePage(d));}
  async function reload(){
    const g=++state.generation;loading=true;state.loaded=false;more.hidden=true;highlights.replaceChildren();list.replaceChildren();status.textContent='Loading layouts…';
    try{const page=await fetchPage(0);if(!current(g))return;
      state.items=page.items;state.offset=page.items.length;state.total=page.total;state.highlights=page.highlights||{};state.signature=signature();state.loaded=true;draw();
    }catch(e){if(current(g)){status.textContent=e.message;list.replaceChildren(onlineSmallButton('Try again','',reload));}}
    finally{if(current(g)){loading=false;more.disabled=false;}}
  }
  async function loadMore(){
    if(loading)return;const g=state.generation;loading=true;more.disabled=true;
    try{const page=await fetchPage(state.offset);if(!current(g))return;const seen=new Set(state.items.map(x=>x.id));state.items.push(...page.items.filter(x=>!seen.has(x.id)));state.offset+=page.items.length;state.total=page.total;draw();}
    catch(e){if(current(g))status.textContent=e.message;}finally{if(current(g)){loading=false;more.disabled=false;}}
  }
  if(state.loaded&&state.signature===signature())draw();else reload();
}
function appendOnlineSourceNote(){
  const source=getCurrentSolution().onlineSource;if(!source)return;
  const note=document.createElement('p');note.className='online-source-note';note.textContent=`Layout from ${source.player} · ${getCurrentSolution().status==='solved'?'Solved locally':'Editable local attempt'}`;boardChrome.appendChild(note);
}

/* ---------- links: #s=<solution> and #p=<puzzle> ---------- */
async function handleOnlineLink(){
  if(!onlineEnabled())return;
  const match=/^#(s|p)=([0-9a-z-]+)$/i.exec(location.hash||'');
  if(!match)return;
  try{history.replaceState(null,'',location.pathname+location.search);}catch(error){}
  if(aboutBackdrop.classList.contains('show'))hideAbout();
  try{
    if(match[1]==='s'){
      const item=requireOnlineData(await onlineApi('GET',`/v1/solutions/${match[2].toLowerCase()}`),d=>validOnlineItem(d)&&validOnlinePuzzle(d.puzzle));
      loadOnlineSolution(findOrImportOnlinePuzzle(item.puzzleHash,item.puzzle),item);
    }else{
      const data=requireOnlineData(await onlineApi('GET',`/v1/puzzles/${match[2].toLowerCase()}`),d=>typeof d.hash==='string'&&validOnlinePuzzle(d.puzzle));
      onlinePuzzleCache.set(data.hash,{at:Date.now(),promise:Promise.resolve(data)});
      openOnlinePuzzleDetail(data);
    }
  }catch(error){showOnlineToast(`Couldn’t open that link: ${error.message}`);}
}
window.addEventListener('hashchange',handleOnlineLink);
document.querySelector('nav.modes [data-mode=online]').hidden=!onlineEnabled();

