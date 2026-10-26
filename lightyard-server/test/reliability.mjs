import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import worker from '../src/worker.js';
import {sqliteEnvironment} from './sqlite-adapter.mjs';
import {normalizePuzzle,normalizeSolution} from '../src/check.js';
import {canonicalOnlinePuzzle,canonicalOnlineLayout} from '../shared/canonical.js';
import {puzzleConfigurationHash,RULES_VERSION} from '../src/core.js';
import {upgradeSql} from '../scripts/upgrade-online.mjs';
const {env,db}=sqliteEnvironment();let passed=0;
async function test(name,fn){await fn();passed++;console.log('ok',name);}
async function call(method,path,body,token,{ip='test',raw,headers={}}={}){
  const request=new Request('https://lightyard.test'+path,{method,headers:{'CF-Connecting-IP':ip,...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:raw!==undefined?raw:body!==undefined?JSON.stringify(body):undefined});
  const r=await worker.fetch(request,env);return {status:r.status,body:await r.json(),headers:r.headers};
}
let alice,bob,hash,id;
const raw={name:'Straight',rows:5,cols:5,elements:[{type:'emitter',r:2,c:0,dirs:['E'],colors:[1]},{type:'receiver',r:2,c:4,dirs:['W'],colors:[1]}]};
const mirror={type:'mirrorDiag',r:0,c:0,orientation:'NE_SW'};
await test('anonymous identities and current identity endpoint',async()=>{alice=(await call('POST','/v1/players')).body;bob=(await call('POST','/v1/players')).body;assert.equal((await call('GET','/v1/players/me',undefined,alice.token)).body.player.id,alice.player.id);});
await test('all invalid JSON envelopes and over-limit UTF-8 bodies are refused',async()=>{
  for(const body of [null,[],42,'text'])assert.equal((await call('POST','/v1/solutions',body,alice.token)).status,400);
  assert.equal((await call('POST','/v1/solutions',undefined,alice.token,{raw:'{' })).status,400);
  assert.equal((await call('POST','/v1/solutions',undefined,alice.token,{raw:JSON.stringify({text:'界'.repeat(70000)})})).status,413);
});
await test('canonical fields, defaults, coordinates, and direction ordering',async()=>{
  const p=normalizePuzzle({...raw,elements:raw.elements.map(e=>({...e,noise:'ignored'}))});assert.equal(puzzleConfigurationHash(p),puzzleConfigurationHash(normalizePuzzle(raw)));
  assert.equal('noise' in p.elements[0],false);
  const a=normalizeSolution(p,{elements:[mirror]}),b=normalizeSolution(p,{elements:[{...mirror,curOrient:'NW_SE',noise:'ignored'}]});assert.deepEqual(a.elements,b.elements);
  assert.deepEqual(canonicalOnlinePuzzle({...raw,elements:[{...raw.elements[0],dirs:['E','N','E']}]}).elements[0].dirs,['N','E']);
  assert.throws(()=>normalizeSolution(p,{elements:[null]}));assert.throws(()=>normalizeSolution(p,{elements:[{...mirror,mirrorColor:1}]}));
});
await test('share puzzle, allow metadata updates by owner only',async()=>{
  hash=(await call('POST','/v1/puzzles',{puzzle:raw},alice.token)).body.hash;
  assert.ok(hash);const r=await call('POST','/v1/puzzles',{puzzle:{...raw,name:'New title',introText:'A hint'}},alice.token);assert.equal(r.body.updated,true);
  await call('POST','/v1/puzzles',{puzzle:{...raw,name:'Not yours'}},bob.token);
  assert.equal((await call('GET','/v1/puzzles/'+hash)).body.name,'New title');
});
await test('zero-piece layout solves and duplicate uploads return same id',async()=>{
  const up=await call('POST','/v1/solutions',{puzzleHash:hash,elements:[],claimedSolved:true,claimedTicks:5},alice.token);assert.equal(up.status,201);id=up.body.id;
  const result=await call('POST',`/v1/solutions/${id}/check`);assert.equal(result.body.status,'solved');assert.equal(result.body.ticks,5);
  const dupe=await call('POST','/v1/solutions',{puzzleHash:hash,elements:[],claimedSolved:true},bob.token);assert.equal(dupe.body.id,id);assert.equal(dupe.body.yours,false);
});
await test('simultaneous identical uploads deduplicate, including also-found credit',async()=>{
  const [a,b]=await Promise.all([call('POST','/v1/solutions',{puzzleHash:hash,elements:[mirror]},alice.token),call('POST','/v1/solutions',{puzzleHash:hash,elements:[{...mirror,extra:'discard'}]},bob.token)]);
  assert.equal(a.body.id,b.body.id);assert.ok([200,201].includes(a.status));assert.ok([200,201].includes(b.status));
});
await test('unverified claims sort after verified results in every sort',async()=>{
  await call('POST','/v1/solutions',{puzzleHash:hash,elements:[{...mirror,c:1}],claimedSolved:true,claimedTicks:1},alice.token);
  for(const sort of ['pieces','ticks','ticks_desc','oldest','newest']){const page=(await call('GET',`/v1/puzzles/${hash}/solutions?sort=${sort}`)).body;assert.equal(page.items[0].id,id);assert.ok(page.items.at(-1).verified===false);}
  assert.equal((await call('GET',`/v1/puzzles/${hash}/solutions?view=attempts`)).body.highlights,undefined);
  assert.equal((await call('GET',`/v1/puzzles/${hash}/solutions?offset=1`)).body.highlights,undefined);
});
await test('moderation repairs solved aggregates and refuses hidden duplicates',async()=>{
  assert.equal((await call('POST','/v1/admin/hide',{kind:'solution',id},'test-admin')).status,200);
  const p=(await call('GET','/v1/puzzles/'+hash)).body;assert.equal(p.solved,false);assert.equal(p.firstSolutionId,null);assert.equal(db.prepare('SELECT solved_at FROM puzzles WHERE hash=?').get(hash).solved_at,null);
  assert.equal((await call('POST','/v1/solutions',{puzzleHash:hash,elements:[]},alice.token)).status,410);
  await call('POST','/v1/admin/hide',{kind:'solution',id,hidden:false},'test-admin');assert.equal((await call('GET','/v1/puzzles/'+hash)).body.solved,true);
});
await test('hiding first solve selects the next visible verified solution',async()=>{
  const up=await call('POST','/v1/solutions',{puzzleHash:hash,elements:[mirror],claimedSolved:true},alice.token);
  const next=up.body.id;assert.equal((await call('POST',`/v1/solutions/${next}/check`)).body.status,'solved');
  await call('POST','/v1/admin/hide',{kind:'solution',id},'test-admin');
  const p=(await call('GET','/v1/puzzles/'+hash)).body;assert.equal(p.solved,true);assert.equal(p.firstSolutionId,next);
  await call('POST','/v1/admin/hide',{kind:'solution',id,hidden:false},'test-admin');
  await call('POST','/v1/admin/hide',{kind:'solution',id:next},'test-admin');
});
await test('failed admin recheck removes solved status; public checks cannot retry it',async()=>{
  const changed={...raw,elements:[raw.elements[0],{...raw.elements[1],colors:[2]}]};db.prepare('UPDATE puzzles SET puzzle_json=? WHERE hash=?').run(JSON.stringify(changed),hash);
  db.prepare("UPDATE solutions SET rules_version='older' WHERE id=?").run(id);
  const check=await call('POST',`/v1/solutions/${id}/check`,undefined,'test-admin');assert.equal(check.body.status,'failed');assert.equal((await call('GET','/v1/puzzles/'+hash)).body.solved,false);
  db.prepare('UPDATE puzzles SET puzzle_json=? WHERE hash=?').run(JSON.stringify(raw),hash);
});
await test('interrupted verification stays saved and cannot be rerun by the public',async()=>{
  const up=await call('POST','/v1/solutions',{puzzleHash:hash,elements:[{...mirror,c:2}],claimedSolved:true},alice.token);
  db.prepare('UPDATE solutions SET check_attempted=1 WHERE id=?').run(up.body.id);
  const result=await call('POST',`/v1/solutions/${up.body.id}/check`);assert.equal(result.body.status,'unverified');assert.equal(result.body.cached,true);assert.match(result.body.verificationNote,/unverified/);
});
await test('canonical migration preserves old links and duplicate ownership',async()=>{
  const legacy='cfg-legacy123',p={...raw,name:'Legacy',elements:raw.elements.map(e=>({...e,padding:123}))};
  db.prepare("INSERT INTO puzzles(hash,source,name,puzzle_json,created_at) VALUES (?,'builtin',?,?,?)").run(legacy,p.name,JSON.stringify(p),Date.now());
  const sql=upgradeSql(db.prepare('SELECT hash,puzzle_json FROM puzzles ORDER BY created_at,hash').all(),db.prepare('SELECT id,puzzle_hash,elements_json FROM solutions').all());db.exec(sql);
  const canonical=puzzleConfigurationHash(normalizePuzzle(raw));const result=await call('GET','/v1/puzzles/'+canonical);assert.equal(result.status,200);
  assert.equal((await call('GET','/v1/puzzles/'+legacy)).status,200);assert.equal(db.prepare('SELECT puzzle_hash FROM puzzle_aliases WHERE alias_hash=?').get(canonical).puzzle_hash,hash);
});
await test('new name rules and admin-hidden names remain hidden',async()=>{
  assert.equal((await call('PUT','/v1/players/me/name',{name:'x'.repeat(25)},alice.token)).status,422);
  assert.equal((await call('PUT','/v1/players/me/name',{name:'Prism Fan'},alice.token)).status,200);
  await call('POST','/v1/admin/hide',{kind:'name',id:alice.player.id},'test-admin');
  const p=(await call('PUT','/v1/players/me/name',{name:'Another Name'},alice.token)).body.player;assert.equal(p.name,null);assert.equal(p.displayName,p.handle);
});
await test('indexes serve quota queries',async()=>{
  for(const [table,column] of [['solutions','player_id'],['puzzles','author_id']])assert.match(db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM ${table} WHERE ${column}=? AND created_at>?`).all('x',0)[0].detail,/USING.*INDEX/);
});
await test('transactional quota rejects insert 61 even for concurrent requests',async()=>{
  const count=db.prepare('SELECT COUNT(*) AS n FROM solutions WHERE player_id=?').get(alice.player.id).n;
  for(let i=count;i<59;i++)db.prepare("INSERT INTO solutions(id,puzzle_hash,player_id,layout_key,elements_json,elements,by_type_json,status,created_at) VALUES (?,?,?,?, '[]',0,'{}','unverified',?)").run('quota'+i,hash,alice.player.id,'quota'+i,Date.now());
  const r=await Promise.all([call('POST','/v1/solutions',{puzzleHash:hash,elements:[{...mirror,r:1,c:1}]},alice.token),call('POST','/v1/solutions',{puzzleHash:hash,elements:[{...mirror,r:1,c:2}]},alice.token)]);
  assert.deepEqual(r.map(x=>x.status).sort(),[201,429]);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM solutions WHERE player_id=?').get(alice.player.id).n,60);
});
await test('IP registration limits work across fresh player identities',async()=>{
  for(let i=0;i<10;i++)assert.equal((await call('POST','/v1/players',undefined,undefined,{ip:'signup-test'})).status,201);
  assert.equal((await call('POST','/v1/players',undefined,undefined,{ip:'signup-test'})).status,429);
});
await test('sharing quota is enforced atomically at twenty puzzles',async()=>{
  const player=(await call('POST','/v1/players',undefined,undefined,{ip:'sharing-quota'})).body;
  for(let i=0;i<19;i++)db.prepare("INSERT INTO puzzles(hash,source,name,puzzle_json,author_id,created_at) VALUES (?,'shared','quota',?,?,?)").run('cfg-quota'+i,JSON.stringify(raw),player.player.id,Date.now());
  const a={...raw,strict:true},b={...raw,noCollisions:true};
  const r=await Promise.all([call('POST','/v1/puzzles',{puzzle:a},player.token),call('POST','/v1/puzzles',{puzzle:b},player.token)]);
  assert.deepEqual(r.map(x=>x.status).sort(),[201,429]);
});
// DOM regression checks: no installed browser or production service is needed.
const noop=new Proxy(function(){},{get:(_,k)=>k==='canvas'?{width:0,height:0}:k==='measureText'?()=>({width:0}):noop,apply:()=>noop,set:()=>true});
let html=fs.readFileSync('client/lightyard-79.html','utf8');
html=html.slice(0,html.lastIndexOf('})();'))+`window.L={State,doTick,openPuzzleBoard,sanitizeSolutionData,persistData,puzzleConfigurationHash,onlinePuzzleHash,onlineUploadRecord,saveOnlineUploadRecord,showOnlineBoard,showOnlineHub,uploadSolutionOnline,showSettingsDialog,showPuzzleSetupDialog,loadOnlineSolution,onlineApi,addCelebrationUploadButtons,findOrImportOnlinePuzzle,canonicalOnlineLayout};})();</script></body></html>`;
function open(){const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://lightyard.test/lightyard.html',virtualConsole:vc,beforeParse(w){w.HTMLCanvasElement.prototype.getContext=()=>noop;w.matchMedia=()=>({matches:false,addEventListener(){}});w.alert=()=>{};w.confirm=()=>true;w.fetch=async(url,init={})=>{const path=new URL(url).pathname+new URL(url).search;const r=await call(init.method||'GET',path,init.body?JSON.parse(init.body):undefined,init.headers?.Authorization?.slice(7),{ip:'browser'});return {ok:r.status<400,status:r.status,json:async()=>r.body};};}});return {dom,w:dom.window,L:dom.window.L,errors};}
const {dom,w,L,errors}=open(),S=L.State,gp=S.puzzles[0];
await test('introduction Backspace cannot delete selected pieces',async()=>{L.openPuzzleBoard(gp,null);S.selectedCell={r:gp.elements[0].r,c:gp.elements[0].c};const n=gp.elements.length;w.document.querySelector('.board-title').click();w.document.querySelector('#setupIntro').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));assert.equal(gp.elements.length,n);assert.equal(S.selectedCell,null);w.document.querySelector('.puzzle-setup-dialog [data-act=cancel]').click();});
const item={id,player:'Test player',elements:0,layout:[],status:'solved',verified:true,ticks:5,byType:{},puzzleHash:hash,submittedAt:Date.now()};
await test('community Board → Load imports remote puzzle before opening',async()=>{L.loadOnlineSolution(raw,item);assert.ok(L.State.puzzles.some(p=>p.id===L.State.currentPuzzleId));assert.equal(L.State.screen,'solutionEdit');});
await test('upload records require matching puzzle, layout, and server',async()=>{const p=L.State.puzzles.find(p=>p.id===L.State.currentPuzzleId),s=L.State.solutions.find(s=>s.id===L.State.currentSolutionId);L.saveOnlineUploadRecord(s,{code:id,api:'https://lightyard.lightyard.workers.dev',puzzleHash:L.onlinePuzzleHash(p),sig:'[]',status:'solved',refreshedAt:Date.now()});assert.ok(L.onlineUploadRecord(s,p));p.strict=true;assert.equal(L.onlineUploadRecord(s,p),null);p.strict=false;});
await test('out-of-order leaderboard responses cannot change current tab',async()=>{const pending=[];w.fetch=(url,init)=>url.includes('/solutions?')?new Promise(resolve=>pending.push(resolve)):Promise.resolve({ok:true,status:200,json:async()=>({hash,puzzle:raw,name:raw.name,source:'shared',solutionCount:0,attemptCount:0})});L.showOnlineBoard(raw);await new Promise(r=>setTimeout(r,0));w.document.querySelectorAll('.online-tabs button')[1].click();pending[1]({ok:true,status:200,json:async()=>({items:[],total:0})});await new Promise(r=>setTimeout(r,0));pending[0]({ok:true,status:200,json:async()=>({items:[item],total:1})});await new Promise(r=>setTimeout(r,0));assert.equal(w.document.querySelector('.online-tabs button.active').textContent,'Attempts');assert.equal(w.document.querySelectorAll('.online-row').length,0);});
await test('malformed successful responses fail with a readable error',async()=>{w.fetch=async()=>({ok:true,status:200,json:async()=>null});await assert.rejects(L.onlineApi('GET','/v1'),/incomplete response/);w.fetch=async()=>({ok:true,status:200,json:async()=>{throw Error('invalid')}});await assert.rejects(L.onlineApi('GET','/v1'),/unreadable response/);});
await test('multiple highlight titles collapse onto one layout card',async()=>{w.fetch=async()=>({ok:true,status:200,json:async()=>({items:[item],total:1,highlights:{fewestPieces:item,fewestTicks:item,first:item,newest:item,mostTicks:item}})});L.showOnlineBoard(raw);await new Promise(r=>setTimeout(r,0));assert.equal(w.document.querySelectorAll('.online-card').length,1);assert.match(w.document.querySelector('.online-card .label').textContent,/Fewest elements.*Fewest ticks/);});
await test('identity controls live in Preferences with matching name length',async()=>{L.showSettingsDialog();assert.equal(w.document.querySelector('#playerNameInput').maxLength,24);assert.equal(w.document.querySelector('#onlinePublicName').maxLength,24);assert.match(w.document.querySelector('.online-identity-note').textContent,/Ownership is tied to this browser/);});
await test('zero-piece upload survives a Cloudflare-style verification error',async()=>{w.localStorage.setItem('lightyard_onlineToken',alice.token);w.localStorage.setItem('lightyard_onlinePlayer',JSON.stringify({...alice.player,name:null}));w.localStorage.setItem('lightyard_onlinePublicName','');const requests=[];w.fetch=async(url,init)=>{requests.push({url,init});if(url.endsWith('/v1/solutions'))return {ok:true,status:201,json:async()=>({id:'zz2345',status:'unverified'})};return {ok:false,status:500,json:async()=>{throw Error('Cloudflare HTML')}};};const sol={id:'zero',elements:[],status:'solved',ticksToSolve:5};const r=await L.uploadSolutionOnline(raw,sol);assert.equal(r.status,'unverified');assert.equal(JSON.parse(requests[0].init.body).elements.length,0);assert.equal(JSON.parse(w.localStorage.getItem('lightyard_onlineUploads')).zero.code,'zz2345');});
await test('share-and-continue never waits for upload or verification',async()=>{const dialog=w.document.createElement('div'),close=w.document.createElement('button');w.document.body.appendChild(dialog);let advanced=false;w.fetch=()=>new Promise(()=>{});L.addCelebrationUploadButtons(dialog,close,raw,{id:'pending',elements:[],status:'solved',ticksToSolve:5},{id:'next'},()=>advanced=true);dialog.querySelector('.victory-share').click();assert.equal(advanced,true);assert.equal(close.disabled,false);});
await test('no uncaught DOM errors',async()=>assert.deepEqual(errors,[]));
dom.window.close();db.close();console.log(`${passed} reliability checks passed`);
