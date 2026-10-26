// Lightyard leaderboard API (Cloudflare Worker + D1). No paid bindings required.
import {normalizePuzzle,normalizeSolution,runSolution,pieceCounts,InvalidSubmission} from './check.js';
import {puzzleConfigurationHash,stableStringify,RULES_VERSION} from './core.js';
import {canonicalOnlinePuzzle,canonicalOnlineLayout} from '../shared/canonical.js';
import {generateHandle,checkCustomName,isOffensive} from './names.js';

const MAX_BODY=200000,PAGE_MAX=50;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'86400'};
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...CORS}});
const now=()=>Date.now();
async function readJson(request){
  const length=Number(request.headers.get('Content-Length'));
  if(Number.isFinite(length)&&length>MAX_BODY)throw new HttpError(413,'Request too large.');
  if(!request.body)throw new HttpError(400,'A JSON object is required.');
  const reader=request.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new HttpError(413,'Request too large.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  finally{reader.releaseLock();}
  let data;try{data=JSON.parse(text);}catch{throw new HttpError(400,'Body must be valid JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'A JSON object is required.');
  return data;
}
async function sha256(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const alphabet='23456789abcdefghjkmnpqrstuvwxyz';
function shortId(len=6){return [...crypto.getRandomValues(new Uint8Array(len))].map(b=>alphabet[b%alphabet.length]).join('');}
function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const intParam=(v,dflt,min,max)=>{const n=Number.parseInt(v,10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):dflt;};
function admin(request,env){return !!env.ADMIN_TOKEN&&request.headers.get('Authorization')==='Bearer '+env.ADMIN_TOKEN;}
function requireAdmin(request,env){if(!admin(request,env))throw new HttpError(403,'Admin only.');}
async function limit(env,key,max,period){
  const t=now(),bucket=Math.floor(t/period),expires=(bucket+1)*period;
  const r=await env.DB.prepare(`INSERT INTO request_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(key+':'+bucket,expires,max).first();
  if(!r)throw new HttpError(429,'Too many requests. Please try again later.');
  if(r.count===1)await env.DB.prepare('DELETE FROM request_limits WHERE key IN (SELECT key FROM request_limits WHERE expires_at < ? LIMIT 100)').bind(t).run();
}
async function requestLimit(request,env){
  const ip=await sha256(request.headers.get('CF-Connecting-IP')||'local');
  if(request.method==='GET'){await limit(env,'read:'+ip,600,600000);return;}
  await limit(env,'write:'+ip,120,3600000);
  if(new URL(request.url).pathname==='/v1/players'&&request.method==='POST')await limit(env,'signup:'+ip,10,3600000);
}
async function requirePlayer(request,env){
  const m=/^Bearer\s+([0-9a-f]{64})$/i.exec(request.headers.get('Authorization')||'');
  if(!m)throw new HttpError(401,'Missing player token.');
  const p=await env.DB.prepare('SELECT * FROM players WHERE token_hash=?').bind(await sha256(m[1].toLowerCase())).first();
  if(!p)throw new HttpError(401,'Unknown player token.');return p;
}
const playerOut=p=>({id:p.id,handle:p.handle,name:p.name_hidden?null:p.custom_name,displayName:p.custom_name&&!p.name_hidden?p.custom_name:p.handle});
const NAME_SQL=`CASE WHEN p.custom_name IS NOT NULL AND p.name_hidden=0 THEN p.custom_name ELSE p.handle END`;
// RULES_VERSION is a generated application constant, never request input.
const CURRENT=`s.rules_version='${RULES_VERSION.replace(/'/g,"''")}'`;
const SOLVED=`s.status='solved' AND ${CURRENT}`;
const EFFECTIVE=`CASE WHEN ${CURRENT} THEN s.status ELSE 'unverified' END`;
const COLS=`s.*, ${NAME_SQL} AS player_name,(SELECT COUNT(*) FROM also_found a WHERE a.solution_id=s.id) AS also_found`;
const resolveHash=`SELECT hash FROM puzzles WHERE hash=? UNION ALL SELECT puzzle_hash FROM puzzle_aliases WHERE alias_hash=? LIMIT 1`;
async function puzzleRow(env,hash,includeHidden=false){
  if(typeof hash!=='string'||!/^cfg-[a-z0-9]+$/.test(hash))throw new HttpError(404,'Puzzle not found.');
  const row=await env.DB.prepare(`SELECT * FROM puzzles WHERE hash=(${resolveHash})`).bind(hash,hash).first();
  if(!row)throw new HttpError(404,'Puzzle not found.');
  if(row.hidden&&!includeHidden)throw new HttpError(410,'This puzzle is no longer available.');return row;
}
async function layoutKey(solution){return (await sha256(stableStringify(canonicalOnlineLayout(solution.elements)))).slice(0,32);}
function solutionOut(row){
  const status=row.rules_version===RULES_VERSION?row.status:'unverified';
  return {id:row.id,puzzleHash:row.puzzle_hash,status,verified:status!=='unverified',rulesVersion:row.rules_version,
    elements:row.elements,byType:JSON.parse(row.by_type_json),ticks:status==='unverified'?null:row.ticks,
    claimedTicks:row.claimed_ticks,claimedSolved:!!row.claimed_solved,failure:status==='failed'?row.failure:null,
    verificationNote:status==='unverified'?row.check_note||null:null,player:row.player_name,playerId:row.player_id,
    alsoFoundBy:row.also_found,submittedAt:row.created_at,layout:JSON.parse(row.elements_json)};
}
function repairPuzzle(env,hash){
  return env.DB.prepare(`UPDATE puzzles SET first_solution_id=(SELECT s.id FROM solutions s WHERE s.puzzle_hash=puzzles.hash AND s.hidden=0 AND ${SOLVED} ORDER BY s.created_at,s.id LIMIT 1),
    solved_at=(SELECT s.checked_at FROM solutions s WHERE s.puzzle_hash=puzzles.hash AND s.hidden=0 AND ${SOLVED} ORDER BY s.created_at,s.id LIMIT 1) WHERE hash=?`).bind(hash);
}
async function createPlayer(request,env){
  const token=randomToken();
  for(let tries=0;tries<4;tries++){
    const p={id:shortId(10),token_hash:await sha256(token),handle:generateHandle(),created_at:now()};
    const r=await env.DB.prepare('INSERT OR IGNORE INTO players(id,token_hash,handle,created_at) VALUES (?,?,?,?)').bind(p.id,p.token_hash,p.handle,p.created_at).run();
    if(r.meta.changes)return json(201,{token,player:playerOut(p)});
  }throw new HttpError(503,'Could not create a player. Please try again.');
}
async function setName(request,env){
  const p=await requirePlayer(request,env);await limit(env,'profile:'+p.id,30,3600000);
  const {name}=await readJson(request);if(typeof name!=='string')throw new HttpError(422,'Name must be text.');
  const check=checkCustomName(name);if(!check.ok)throw new HttpError(422,check.reason);
  await env.DB.prepare('UPDATE players SET custom_name=? WHERE id=?').bind(check.name,p.id).run();
  return json(200,{player:playerOut({...p,custom_name:check.name})});
}
async function rerollHandle(request,env){
  const p=await requirePlayer(request,env);await limit(env,'profile:'+p.id,30,3600000);
  const handle=generateHandle();await env.DB.prepare('UPDATE players SET handle=? WHERE id=?').bind(handle,p.id).run();return json(200,{player:playerOut({...p,handle})});
}
async function sharePuzzle(request,env){
  const p=await requirePlayer(request,env),{puzzle:raw}=await readJson(request);
  const puzzle=normalizePuzzle(raw),stored=canonicalOnlinePuzzle(puzzle);
  if(stored.introText.length>12000)throw new HttpError(422,'Online introductions must be at most 12,000 characters.');
  if(isOffensive(puzzle.name)||isOffensive(puzzle.introText))throw new HttpError(422,'Please change the puzzle name or intro text.');
  const hash=puzzleConfigurationHash(puzzle);let existing=null;
  try{existing=await puzzleRow(env,hash,true);}catch(e){if(e.status!==404)throw e;}
  if(existing){
    if(existing.hidden)throw new HttpError(410,'This puzzle is no longer available for sharing.');
    // The creator can correct presentation without changing the configuration.
    let updated=false;
    if(existing.source==='shared'&&existing.author_id===p.id){
      await env.DB.prepare('UPDATE puzzles SET name=?,puzzle_json=? WHERE hash=? AND author_id=?').bind(puzzle.name,JSON.stringify(stored),existing.hash,p.id).run();updated=true;
    }
    return json(200,{hash:existing.hash,existing:true,updated,source:existing.source,name:updated?puzzle.name:existing.name});
  }
  const r=await env.DB.prepare(`INSERT OR IGNORE INTO puzzles(hash,source,name,puzzle_json,author_id,created_at) VALUES (?,'shared',?,?,?,?)`).bind(hash,puzzle.name,JSON.stringify(stored),p.id,now()).run();
  return json(r.meta.changes?201:200,{hash,existing:!r.meta.changes,source:'shared'});
}
function searchTerm(url){
  const text=(url.searchParams.get('q')||'').trim();
  if(text.length>80)throw new HttpError(400,'Search must be at most 80 characters.');
  return text?'%'+text.replace(/[\\%_]/g,c=>'\\'+c)+'%':null;
}
const PUZZLES=`SELECT z.*,${NAME_SQL} AS author_name,
  (SELECT MIN(s.elements) FROM solutions s WHERE s.puzzle_hash=z.hash AND s.hidden=0 AND ${SOLVED}) AS best_elements,
  (SELECT MIN(s.ticks) FROM solutions s WHERE s.puzzle_hash=z.hash AND s.hidden=0 AND ${SOLVED}) AS best_ticks,
  (SELECT COUNT(*) FROM solutions s WHERE s.puzzle_hash=z.hash AND s.hidden=0 AND ${SOLVED}) AS solution_count,
  (SELECT COUNT(*) FROM solutions s WHERE s.puzzle_hash=z.hash AND s.hidden=0 AND NOT (${SOLVED})) AS attempt_count
  FROM puzzles z LEFT JOIN players p ON p.id=z.author_id`;
function puzzleOut(row,{preview=false}={}){
  const solved=row.solution_count>0;
  const out={hash:row.hash,source:row.source,name:row.name,set:row.set_name||null,author:row.author_name||null,sharedAt:row.created_at,
    solved,firstSolvedAt:solved?row.solved_at:null,firstSolutionId:solved?row.first_solution_id:null,solutionCount:row.solution_count,attemptCount:row.attempt_count,bestElements:row.best_elements??null,bestTicks:row.best_ticks??null};
  if(preview){const p=JSON.parse(row.puzzle_json);out.preview={rows:p.rows,cols:p.cols,elements:p.elements};}
  return out;
}
async function listPuzzles(url,env){
  const source=url.searchParams.get('source')||'shared',sort=url.searchParams.get('sort')||'newest';
  if(!['shared','builtin','all'].includes(source))throw new HttpError(400,'Unknown puzzle source.');
  const order={newest:'z.created_at DESC,z.hash',oldest:'z.created_at,z.hash',unsolved:'(solution_count>0),z.created_at DESC,z.hash',recently_solved:'(solution_count=0),z.solved_at DESC,z.hash',name:'z.name COLLATE NOCASE,z.hash',solutions:'solution_count DESC,z.created_at DESC,z.hash'}[sort];
  if(!order)throw new HttpError(400,'Unknown sort.');
  const limit=intParam(url.searchParams.get('limit'),30,1,PAGE_MAX),offset=intParam(url.searchParams.get('offset'),0,0,10000);
  const term=searchTerm(url),args=[],where=['z.hidden=0'];
  if(source!=='all'){where.push('z.source=?');args.push(source);}
  if(term){where.push(`(z.name LIKE ? ESCAPE '\\' OR COALESCE(z.set_name,'') LIKE ? ESCAPE '\\' OR ${NAME_SQL} LIKE ? ESCAPE '\\')`);args.push(term,term,term);}
  const r=await env.DB.prepare(`${PUZZLES} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...args,limit+1,offset).all();
  return json(200,{items:r.results.slice(0,limit).map(r=>puzzleOut(r,{preview:true})),limit,offset,hasMore:r.results.length>limit});
}
async function getPuzzle(env,hash){
  const p=await puzzleRow(env,hash),row=await env.DB.prepare(`${PUZZLES} WHERE z.hash=?`).bind(p.hash).first();
  return json(200,{...puzzleOut(row),puzzle:canonicalOnlinePuzzle(JSON.parse(row.puzzle_json))});
}
async function duplicateReply(env,dup,player){
  if(dup.hidden)throw new HttpError(410,'This layout is no longer available for sharing.');
  if(dup.player_id!==player.id)await env.DB.prepare('INSERT OR IGNORE INTO also_found(solution_id,player_id,created_at) VALUES (?,?,?)').bind(dup.id,player.id,now()).run();
  return json(200,{id:dup.id,status:dup.rules_version===RULES_VERSION?dup.status:'unverified',duplicate:true,yours:dup.player_id===player.id});
}
async function uploadSolution(request,env){
  const p=await requirePlayer(request,env),body=await readJson(request),row=await puzzleRow(env,body.puzzleHash);
  const puzzle=normalizePuzzle(JSON.parse(row.puzzle_json)),solution=normalizeSolution(puzzle,{elements:body.elements}),key=await layoutKey(solution);
  const find=()=>env.DB.prepare('SELECT * FROM solutions WHERE puzzle_hash=? AND (canonical_key=? OR layout_key=?) ORDER BY created_at,id LIMIT 1').bind(row.hash,key,key).first();
  const dup=await find();if(dup)return duplicateReply(env,dup,p);
  const counts=pieceCounts(solution),claimedTicks=Number.isInteger(body.claimedTicks)&&body.claimedTicks>=0&&body.claimedTicks<=99999?body.claimedTicks:null;
  for(let tries=0;tries<4;tries++){
    const id=shortId();
    const r=await env.DB.prepare(`INSERT OR IGNORE INTO solutions(id,puzzle_hash,player_id,layout_key,canonical_key,elements_json,elements,by_type_json,status,claimed_solved,claimed_ticks,created_at)
      VALUES (?,?,?,?,?,?,?,?,'unverified',?,?,?)`).bind(id,row.hash,p.id,key,key,JSON.stringify(solution.elements),counts.elements,JSON.stringify(counts.byType),body.claimedSolved===true?1:0,claimedTicks,now()).run();
    if(r.meta.changes)return json(201,{id,status:'unverified',duplicate:false});
    const concurrent=await find();if(concurrent)return duplicateReply(env,concurrent,p);
  }throw new HttpError(503,'Could not save the layout. Please try again.');
}
function checkOut(row,cached=true){return {id:row.id,status:row.rules_version===RULES_VERSION?row.status:'unverified',ticks:row.rules_version===RULES_VERSION&&row.status!=='unverified'?row.ticks:null,
  failure:row.status==='failed'&&row.rules_version===RULES_VERSION?row.failure:null,verificationNote:row.check_note||null,rulesVersion:RULES_VERSION,cached};}
async function checkSolution(request,env,id){
  const row=await env.DB.prepare('SELECT * FROM solutions WHERE id=? AND hidden=0').bind(id).first();if(!row)throw new HttpError(404,'Solution not found.');
  const puzzle=await puzzleRow(env,row.puzzle_hash);
  if(row.status!=='unverified'&&row.rules_version===RULES_VERSION)return json(200,checkOut(row));
  const retry=admin(request,env);
  if(row.check_attempted&&!retry)return json(200,{...checkOut(row),verificationNote:row.check_note||'Verification was not completed. This layout remains unverified.'});
  // Commit the attempt BEFORE computation. CPU termination cannot cause public retries.
  const claim=await env.DB.prepare(`UPDATE solutions SET check_attempted=1,status='unverified',ticks=NULL,failure=NULL,rules_version=?,check_note='Verification was not completed. This layout remains unverified.' WHERE id=? ${retry?'':'AND check_attempted=0'} RETURNING id`).bind(RULES_VERSION,id).first();
  if(!claim)return json(200,{id,status:'unverified',ticks:null,failure:null,cached:true,verificationNote:'Verification is unavailable for this layout.'});
  await repairPuzzle(env,row.puzzle_hash).run();
  let result;
  try{const p=normalizePuzzle(JSON.parse(puzzle.puzzle_json));result=runSolution(p,normalizeSolution(p,{elements:JSON.parse(row.elements_json)}),{maxPacketMoves:100000,maxPackets:512});}
  catch(e){console.error('verification failed',id,e);return json(200,{id,status:'unverified',ticks:null,failure:null,verificationNote:'Verification could not be completed. Your layout is saved.',cached:false});}
  if(result.outcome==='stopped')return json(200,{id,status:'unverified',ticks:null,failure:null,verificationNote:'Verification exceeded the work limit. Your layout is saved.',cached:false});
  const status=result.outcome==='solved'?'solved':'failed',t=now();
  await env.DB.batch([env.DB.prepare('UPDATE solutions SET status=?,ticks=?,failure=?,rules_version=?,checked_at=?,check_note=NULL WHERE id=?').bind(status,result.ticks,result.failure,RULES_VERSION,t,id),repairPuzzle(env,row.puzzle_hash)]);
  return json(200,{id,status,ticks:result.ticks,failure:result.failure,rulesVersion:RULES_VERSION,cached:false});
}
async function getSolution(env,id){
  const row=await env.DB.prepare(`SELECT ${COLS},z.puzzle_json,z.name AS puzzle_name FROM solutions s JOIN players p ON p.id=s.player_id JOIN puzzles z ON z.hash=s.puzzle_hash WHERE s.id=? AND s.hidden=0 AND z.hidden=0`).bind(id).first();
  if(!row)throw new HttpError(404,'Solution not found.');
  return json(200,{...solutionOut(row),puzzleName:row.puzzle_name,puzzle:canonicalOnlinePuzzle(JSON.parse(row.puzzle_json))});
}
async function listSolutions(url,env,hash){
  const puzzle=await puzzleRow(env,hash);hash=puzzle.hash;
  const view=url.searchParams.get('view')==='attempts'?'attempts':'solutions',sort=url.searchParams.get('sort')||'pieces';
  const T=`CASE WHEN ${CURRENT} AND s.status<>'unverified' THEN s.ticks ELSE s.claimed_ticks END`;
  const orders={pieces:`s.elements,${T},s.created_at,s.id`,ticks:`${T},s.elements,s.created_at,s.id`,ticks_desc:`${T} DESC,s.elements,s.created_at,s.id`,oldest:'s.created_at,s.id',newest:'s.created_at DESC,s.id'};
  if(!orders[sort])throw new HttpError(400,'Unknown sort.');
  const where=view==='solutions'?`((${SOLVED}) OR (${EFFECTIVE}='unverified' AND s.claimed_solved=1))`:`(${EFFECTIVE}='failed' OR (${EFFECTIVE}='unverified' AND s.claimed_solved=0))`;
  const limit=intParam(url.searchParams.get('limit'),30,1,PAGE_MAX),offset=intParam(url.searchParams.get('offset'),0,0,10000);
  const term=searchTerm(url),args=term?[hash,term]:[hash];
  const base=`FROM solutions s JOIN players p ON p.id=s.player_id WHERE s.puzzle_hash=? AND s.hidden=0${term?` AND ${NAME_SQL} LIKE ? ESCAPE '\\'`:''}`;
  const queries=[env.DB.prepare(`SELECT ${COLS} ${base} AND ${where} ORDER BY (${EFFECTIVE}='unverified'),${orders[sort]} LIMIT ? OFFSET ?`).bind(...args,limit,offset),env.DB.prepare(`SELECT COUNT(*) AS n ${base} AND ${where}`).bind(...args)];
  const highlights=!term&&view==='solutions'&&offset===0&&url.searchParams.get('highlights')!=='0';
  if(highlights){const keys=[['fewestPieces','s.elements,s.ticks,s.created_at,s.id'],['fewestTicks','s.ticks,s.elements,s.created_at,s.id'],['mostTicks','s.ticks DESC,s.elements,s.created_at,s.id'],['first','s.created_at,s.id'],['newest','s.created_at DESC,s.id']];
    queries.push(env.DB.prepare(keys.map(([key,order])=>`SELECT '${key}' AS k,* FROM (SELECT ${COLS} ${base} AND ${SOLVED} ORDER BY ${order} LIMIT 1)`).join(' UNION ALL ')).bind(hash,hash,hash,hash,hash));}
  const [page,total,records]=await env.DB.batch(queries),hl={};for(const r of records?.results||[])hl[r.k]=solutionOut(r);
  return json(200,{view,sort,total:total.results[0].n,limit,offset,...(highlights?{highlights:hl}:{}),items:page.results.map(solutionOut)});
}
async function adminHide(request,env){
  requireAdmin(request,env);const {kind,id,hidden=true}=await readJson(request);
  if(typeof id!=='string'||typeof hidden!=='boolean')throw new HttpError(400,'A valid id and boolean hidden value are required.');
  const sql={solution:'UPDATE solutions SET hidden=? WHERE id=?',puzzle:'UPDATE puzzles SET hidden=? WHERE hash=?',name:'UPDATE players SET name_hidden=? WHERE id=?'}[kind];
  if(!sql)throw new HttpError(400,'kind must be solution, puzzle, or name.');
  const target=kind==='solution'?await env.DB.prepare('SELECT puzzle_hash FROM solutions WHERE id=?').bind(id).first():null;
  const stmts=[env.DB.prepare(sql).bind(hidden?1:0,id)];if(target)stmts.push(repairPuzzle(env,target.puzzle_hash));
  const r=await env.DB.batch(stmts);return json(200,{changed:r[0].meta.changes});
}
async function adminStale(url,env,request){requireAdmin(request,env);const limit=intParam(url.searchParams.get('limit'),500,1,5000);
  const rows=await env.DB.prepare(`SELECT id FROM solutions WHERE hidden=0 AND (status='unverified' OR rules_version IS NOT ?) ORDER BY created_at,id LIMIT ?`).bind(RULES_VERSION,limit).all();return json(200,{rulesVersion:RULES_VERSION,ids:rows.results.map(r=>r.id)});}
const routes=[
 ['GET',/^\/v1\/?$/,()=>json(200,{service:'lightyard',rulesVersion:RULES_VERSION,onlineSchema:2})],
 ['POST',/^\/v1\/players$/,createPlayer],['GET',/^\/v1\/players\/me$/,async(req,env)=>json(200,{player:playerOut(await requirePlayer(req,env))})],
 ['PUT',/^\/v1\/players\/me\/name$/,setName],['POST',/^\/v1\/players\/me\/handle$/,rerollHandle],
 ['GET',/^\/v1\/puzzles$/,(req,env,m,url)=>listPuzzles(url,env)],['POST',/^\/v1\/puzzles$/,sharePuzzle],
 ['GET',/^\/v1\/puzzles\/(cfg-[0-9a-z]+)$/,(req,env,m)=>getPuzzle(env,m[1])],
 ['GET',/^\/v1\/puzzles\/(cfg-[0-9a-z]+)\/solutions$/,(req,env,m,url)=>listSolutions(url,env,m[1])],
 ['POST',/^\/v1\/solutions$/,uploadSolution],['GET',/^\/v1\/solutions\/([0-9a-z]{6})$/,(req,env,m)=>getSolution(env,m[1])],
 ['POST',/^\/v1\/solutions\/([0-9a-z]{6})\/check$/,(req,env,m)=>checkSolution(req,env,m[1])],
 ['POST',/^\/v1\/admin\/hide$/,adminHide],['GET',/^\/v1\/admin\/stale$/,(req,env,m,url)=>adminStale(url,env,req)]
];
export default {async fetch(request,env){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 const url=new URL(request.url);
 try{for(const [method,re,handler] of routes){const m=re.exec(url.pathname);if(m&&request.method===method){if(!admin(request,env))await requestLimit(request,env);return await handler(request,env,m,url);}}
 throw new HttpError(404,'Not found.');
 }catch(e){if(e instanceof HttpError)return json(e.status,{error:e.message});if(e instanceof InvalidSubmission)return json(422,{error:e.message});
 const msg=String(e.message||e);if(msg.includes('quota:uploads'))return json(429,{error:'Upload limit reached. Try again in an hour.'});if(msg.includes('quota:shares'))return json(429,{error:'Daily sharing limit reached. Try again tomorrow.'});
 console.error(e);return json(500,{error:'The server could not complete this request. Please try again later.'});}
}};
