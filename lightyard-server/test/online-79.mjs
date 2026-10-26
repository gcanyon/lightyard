import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import worker from '../src/worker.js';
import {sqliteEnvironment} from './sqlite-adapter.mjs';
import {RULES_VERSION} from '../src/core.js';
import {normalizePuzzle} from '../src/check.js';
import {canonicalOnlinePuzzle} from '../shared/canonical.js';
import {puzzleConfigurationHash} from '../src/core.js';
const {env,db}=sqliteEnvironment();let passed=0;
async function call(path,method='GET',body,token){const r=await worker.fetch(new Request('https://test'+path,{method,headers:{'CF-Connecting-IP':'online79',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json()};}
const raw={name:'Straight',rows:5,cols:5,introText:'A straight path.',elements:[{type:'emitter',r:2,c:0,dirs:['E'],colors:[1]},{type:'receiver',r:2,c:4,dirs:['W'],colors:[1]}]};
const alice=(await call('/v1/players','POST')).body;await call('/v1/players/me/name','PUT',{name:'Amber Fan'},alice.token);
const hash=(await call('/v1/puzzles','POST',{puzzle:raw},alice.token)).body.hash;
const sid=(await call('/v1/solutions','POST',{puzzleHash:hash,elements:[],claimedSolved:true,claimedTicks:5},alice.token)).body.id;await call('/v1/solutions/'+sid+'/check','POST');
const uploaded=(await call('/v1/solutions/'+sid)).body;
const built={...raw,name:'Built in 100%_puzzle',strict:true};const bhash=puzzleConfigurationHash(normalizePuzzle(built));db.prepare("INSERT INTO puzzles(hash,source,name,set_name,puzzle_json,created_at) VALUES (?,'builtin',?,'Intro Set',?,?)").run(bhash,built.name,JSON.stringify(canonicalOnlinePuzzle(normalizePuzzle(built))),Date.now());
async function test(name,fn){await fn();passed++;console.log('ok',name);}
await test('all-source catalog includes built-in definitions without benchmark layouts',async()=>{const r=await call('/v1/puzzles?source=all');assert.equal(r.status,200);assert.equal(r.body.items.length,2);const b=r.body.items.find(x=>x.hash===bhash);assert.equal(b.solutionCount,0);assert.equal(b.bestElements,null);assert.equal('goal' in b.preview,false);assert.equal('solutions' in b,false);});
await test('catalog filters and search apply before pagination; SQL wildcards are literal',async()=>{
 for(const [source,n] of [['builtin',1],['shared',1],['all',2]])assert.equal((await call('/v1/puzzles?source='+source)).body.items.length,n);
 for(const q of ['100%_','Intro Set','Amber Fan'])assert.equal((await call('/v1/puzzles?source=all&q='+encodeURIComponent(q))).body.items.length,1);
 assert.equal((await call('/v1/puzzles?source=all&q='+encodeURIComponent('no matches'))).body.items.length,0);assert.equal((await call('/v1/puzzles?q='+ 'x'.repeat(81))).status,400);
 const r=(await call('/v1/puzzles?source=all&sort=solutions&limit=1')).body;assert.equal(r.items[0].hash,hash);assert.equal(r.hasMore,true);
});
await test('stats use visible verified records, preserve zero, and expose no layouts',async()=>{
 let r=(await call('/v1/puzzles/'+hash)).body;assert.equal(r.bestElements,0);assert.equal(r.bestTicks,5);assert.equal(r.solutionCount,1);assert.equal('layout' in r,false);
 db.prepare("UPDATE solutions SET rules_version='old' WHERE id=?").run(sid);r=(await call('/v1/puzzles/'+hash)).body;assert.equal(r.bestElements,null);assert.equal(r.solutionCount,0);db.prepare('UPDATE solutions SET rules_version=? WHERE id=?').run(RULES_VERSION,sid);
});
await test('solution search filters names and totals, keeps verified sort, and omits highlights',async()=>{
 const hit=(await call(`/v1/puzzles/${hash}/solutions?q=Amber`)).body;assert.equal(hit.total,1);assert.equal(hit.items[0].id,sid);assert.equal(hit.highlights,undefined);assert.equal((await call(`/v1/puzzles/${hash}/solutions?q=missing`)).body.total,0);assert.equal((await call(`/v1/puzzles/${hash}/solutions?q=`+'x'.repeat(81))).status,400);
});
const noop=new Proxy(function(){},{get:(_,k)=>k==='canvas'?{width:0,height:0}:k==='measureText'?()=>({width:0}):noop,apply:()=>noop,set:()=>true});
const source=fs.readFileSync(process.argv[2]||'client/lightyard-79.html','utf8');
const hook=`window.L={State,showOnlineHub,showOnlineBoard,openOnlinePuzzleDetail,onlineBrowse,onlinePuzzleCache,loadOnlineSolution,openPuzzleBoard,closeBoardToList,getCurrentSolution,canEditNow,doTick,finishRun,finishFailureScene,hideAbout,persistData,renderScreen,sanitizeSolutionData,showPuzzleSetupDialog,exportHTML(){const old=downloadTextFile;try{downloadTextFile=(html)=>window.exportedHTML=html;downloadWebApp(true);return window.exportedHTML;}finally{downloadTextFile=old;}}};})();</script></body></html>`;
const errors=[],requests=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(source.slice(0,source.lastIndexOf('})();'))+hook,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://lightyard.test/lightyard.html',virtualConsole:vc,beforeParse(w){w.HTMLCanvasElement.prototype.getContext=()=>noop;w.HTMLCanvasElement.prototype.toDataURL=()=>'';w.matchMedia=()=>({matches:false,addEventListener(){}});w.alert=()=>{};w.confirm=()=>true;w.fetch=async(url,init)=>{requests.push(url);const u=new URL(url),r=await call(u.pathname+u.search,init?.method||'GET',init?.body?JSON.parse(init.body):undefined,init?.headers?.Authorization?.slice(7));return {ok:r.status<400,status:r.status,json:async()=>r.body};};}});
const w=dom.window,L=w.L,S=L.State;L.hideAbout();const tick=()=>new Promise(r=>setTimeout(r,10));
await test('Online Puzzles is a main navigation page with both sources and no modal',async()=>{w.document.querySelector('[data-mode=online]').click();await tick();assert.equal(S.mode,'online');assert.equal(S.screen,'online');assert.equal(w.document.querySelectorAll('.online-catalog-row').length,2);assert.equal(w.document.querySelector('.online-backdrop'),null);assert.equal(w.document.querySelector('[data-mode=online]').hidden,false);assert.ok(requests.some(x=>x.includes('source=all')));});
await test('puzzle detail never fetches or renders solutions before explicit reveal',async()=>{requests.length=0;w.document.querySelectorAll('.online-view-puzzle')[0].click();await tick();assert.ok(w.document.querySelector('.online-detail-preview'));assert.equal(w.document.querySelector('#onlineSolutions').hidden,true);assert.equal(w.document.querySelectorAll('.online-row').length,0);assert.equal(requests.some(x=>x.includes('/solutions')),false);assert.ok([...w.document.querySelectorAll('button')].some(x=>x.textContent==='Try It'));});
await test('Try It imports once, opens fresh blank, and returns to same detail',async()=>{
 const n=S.puzzles.length;[...w.document.querySelectorAll('button')].find(x=>x.textContent==='Try It').click();assert.equal(S.screen,'solutionEdit');assert.equal(S.currentSolutionId,'BLANK');assert.equal(S.puzzles.length,n+1);const pid=S.currentPuzzleId;assert.equal(w.document.querySelector('#detailListBtn').textContent,'Online Puzzles');L.closeBoardToList();await tick();assert.equal(S.screen,'online');assert.ok(w.document.querySelector('.online-detail-preview'));assert.equal(w.document.querySelector('#onlineSolutions').hidden,true);[...w.document.querySelectorAll('button')].find(x=>x.textContent==='Try It').click();assert.equal(S.currentPuzzleId,pid);assert.equal(S.puzzles.length,n+1);L.closeBoardToList();await tick();
});
await test('list restores search, sorting and scroll after detail and board navigation',async()=>{
 L.showOnlineHub();await tick();const search=w.document.querySelector('input[type=search]');search.value='Straight';search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();assert.equal(w.document.querySelectorAll('.online-catalog-row').length,1);w.document.querySelector('#leftPanel').scrollTop=126;w.document.querySelector('.online-view-puzzle').click();await tick();w.document.querySelector('.online-back').click();await tick();assert.equal(w.document.querySelector('input[type=search]').value,'Straight');assert.equal(w.document.querySelector('#leftPanel').scrollTop,126);assert.equal(w.document.querySelectorAll('.online-catalog-row').length,1);
});
await test('Show Solutions reveals rows, combines titles, and imports editable attributed attempts',async()=>{
 w.document.querySelector('.online-view-puzzle').click();await tick();requests.length=0;[...w.document.querySelectorAll('button')].find(x=>x.textContent==='Show Solutions').click();await tick();assert.ok(requests.some(x=>x.includes('/solutions')));assert.equal(w.document.querySelectorAll('.online-card').length,1);assert.equal(w.document.querySelectorAll('.online-row').length,1);w.document.querySelector('.online-row .actions button').click();const s=L.getCurrentSolution();assert.equal(s.status,'in-progress');assert.equal(L.canEditNow(),true);assert.equal(s.onlineSource.player,'Amber Fan');assert.equal(s.onlineSource.solutionId,sid);assert.match(w.document.querySelector('.online-source-note').textContent,/Amber Fan/);assert.equal(s.ticksToSolve,undefined);
});
await test('repeat opens reuse unchanged editable imports, preserve edited and solved work',async()=>{
 const p=S.puzzles.find(p=>p.id===S.currentPuzzleId),first=S.currentSolutionId,n=S.solutions.length;L.loadOnlineSolution(raw,uploaded);assert.equal(S.currentSolutionId,first);assert.equal(S.solutions.length,n);
 const s=L.getCurrentSolution();s.elements.push({type:'mirrorDiag',r:0,c:0,orientation:'NE_SW'});L.persistData();L.loadOnlineSolution(raw,uploaded);assert.notEqual(S.currentSolutionId,first);assert.equal(s.elements.length,1);const imported=L.getCurrentSolution();imported.status='solved';imported.ticksToSolve=5;L.persistData();L.loadOnlineSolution(raw,uploaded);assert.notEqual(S.currentSolutionId,imported.id);assert.equal(imported.status,'solved');assert.equal(L.getCurrentSolution().status,'in-progress');
});
await test('imported layout only becomes solved and locked after successful local playback',async()=>{
 for(let i=0;i<20&&!S.finished;i++){L.doTick();if(S.failureScene)L.finishFailureScene();if(S.finishAfterAnimation){S.finishAfterAnimation=false;L.finishRun();}}
 assert.equal(L.getCurrentSolution().status,'solved');assert.equal(L.canEditNow(),false);assert.equal(L.getCurrentSolution().ticksToSolve,5);assert.match(w.document.querySelector('.online-source-note').textContent,/Solved locally/);
});
await test('attribution survives backup sanitization and public export contains no benchmark layouts',async()=>{
 const p=S.puzzles.find(p=>p.id===S.currentPuzzleId),s=L.getCurrentSolution(),copy=L.sanitizeSolutionData(JSON.parse(JSON.stringify(s)),p);assert.equal(copy.onlineSource.player,'Amber Fan');
 const exported=L.exportHTML(),match=/\/\*__LIGHTYARD_EMBED_START__\*\/\s*([\s\S]*?)\s*\/\*__LIGHTYARD_EMBED_END__\*\//.exec(exported);const catalog=JSON.parse(match[1]);assert.equal('solutions' in catalog,false);assert.ok(catalog.puzzles.every(p=>!('solutions' in p)));assert.ok(exported.includes('function renderOnlinePage'));
});
await test('built-in Try It reuses the built-in definition and does not copy benchmarks',async()=>{
 w.document.querySelectorAll('.celebration-layer').forEach(n=>n.remove());const local={...built,id:'builtin:79',_sourceId:'source79',_builtIn:true,setId:S.sets[0].id};S.builtInPuzzles.push(local);const n=S.puzzles.length;
 L.onlineBrowse.source='builtin';L.onlineBrowse.query='';L.onlineBrowse.loaded=false;L.showOnlineHub();await tick();w.document.querySelector('.online-view-puzzle').click();await tick();assert.equal(w.document.querySelector('#onlineSolutions').hidden,true);[...w.document.querySelectorAll('button')].find(x=>x.textContent==='Try It').click();assert.equal(S.currentPuzzleId,local.id);assert.equal(S.puzzles.length,n);assert.equal(S.currentSolutionId,'BLANK');assert.equal(L.getCurrentSolution().elements.length,0);
});
await test('late catalog replies cannot replace changed search or navigate back from a board',async()=>{
 w.document.querySelectorAll('.celebration-layer').forEach(n=>n.remove());const pending=[];w.fetch=(url)=>new Promise(resolve=>pending.push({url,resolve}));L.onlineBrowse.loaded=false;L.showOnlineHub();const search=w.document.querySelector('input[type=search]');search.value='changed';search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(pending.length,2);
 pending[1].resolve({ok:true,status:200,json:async()=>({items:[],limit:30,hasMore:false})});await tick();pending[0].resolve({ok:true,status:200,json:async()=>({items:[{hash,name:'STALE',source:'shared',solutionCount:0,attemptCount:0}],limit:30,hasMore:false})});await tick();assert.equal(w.document.querySelectorAll('.online-catalog-row').length,0);
 L.showOnlineHub();const p=S.puzzles[0];L.openPuzzleBoard(p,'BLANK');pending.at(-1).resolve({ok:true,status:200,json:async()=>({items:[],limit:30,hasMore:false})});await tick();assert.equal(S.screen,'solutionEdit');
});
await test('no uncaught browser errors',async()=>assert.deepEqual(errors,[]));
dom.window.close();db.close();console.log(`${passed} online browser and API checks passed`);
