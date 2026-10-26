import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
const source=fs.readFileSync(process.argv[2]||'client/lightyard-79.html','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const noop=new Proxy(function(){},{get:(_,k)=>k==='canvas'?{width:0,height:0}:k==='measureText'?()=>({width:0}):noop,apply:()=>noop,set:()=>true});
const hooks=`window.L={State,openPuzzleBoard,renderScreen,placeElement,removeElementAt,mutateSelectedConfig,cloneElementTo,selectCell,saveCurrentDoc,stepEditHistory,syncEditHistory,editHistories,getHistory:()=>activeEditHistory,getCurrentSolution,persistData,puzzleConfigurationHash,applyPuzzleArrangement,showPuzzleArrangeDialog,showPuzzleSetupDialog,showSolutionSetupSheet,newBlankSolution,doTick,hideAbout,showSettingsDialog,downloadWebApp,exportHTML(){const old=downloadTextFile;try{downloadTextFile=(html)=>{window.exportedHTML=html;};downloadWebApp(true);return window.exportedHTML;}finally{downloadTextFile=old;}}};})();</script></body></html>`;
function open(src=source){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(src.slice(0,src.lastIndexOf('})();'))+hooks,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://lightyard.test/lightyard.html',virtualConsole:vc,beforeParse(w){w.HTMLCanvasElement.prototype.getContext=()=>noop;w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';w.matchMedia=()=>({matches:false,addEventListener(){}});w.alert=()=>{};w.confirm=()=>true;w.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Offline test'})});}});
 assert.ok(dom.window.L,errors.join('\n'));dom.window.L.hideAbout();return {dom,w:dom.window,L:dom.window.L,S:dom.window.L.State,errors};
}
let id=0,passed=0;
function puzzle(C,extra={}){const p={id:'testp'+(++id),setId:C.S.sets[0].id,name:'History puzzle',rows:7,cols:7,elements:[],strict:false,noPrisms:false,noHalfMirrors:false,...extra};C.S.puzzles.push(p);C.L.persistData();return p;}
function solution(C,p,extra={}){const s={id:'tests'+(++id),puzzleId:p.id,puzzleHash:C.L.puzzleConfigurationHash(p),name:'Attempt',status:'in-progress',createdAt:Date.now(),elements:[],...extra};C.S.solutions.push(s);C.L.persistData();return s;}
function key(C,k,extra={},target=C.w.document.body){const e=new C.w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,metaKey:true,...extra});target.dispatchEvent(e);return e;}
function test(name,fn){const C=open();try{fn(C);assert.deepEqual(C.errors,[]);passed++;console.log('ok',name);}finally{C.dom.window.close();}}
const btn=(C,action)=>C.w.document.querySelector(`[data-edit-history=${action}]`);
test('placement, configuration, deletion, persistence, no-op edits',C=>{
 const p=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(p,null);assert.equal(btn(C,'undo').disabled,true);
 C.L.placeElement(1,1,'mirrorDiag',true);C.L.mutateSelectedConfig(e=>e.orientation='NW_SE');C.L.removeElementAt(1,1);
 btn(C,'undo').click();assert.equal(p.elements[0].orientation,'NW_SE');C.L.stepEditHistory(-1);assert.equal(p.elements[0].orientation,'NE_SW');C.L.stepEditHistory(-1);assert.equal(p.elements.length,0);
 C.L.stepEditHistory(1);C.L.stepEditHistory(1);const n=C.L.getHistory().index;C.L.selectCell(1,1);C.L.mutateSelectedConfig(()=>{});assert.equal(C.L.getHistory().index,n);assert.equal(btn(C,'redo').disabled,false);C.L.stepEditHistory(1);
 assert.equal(JSON.parse(C.w.localStorage.getItem('lightyard_data')).puzzles.find(x=>x.id===p.id).elements.length,0);
});
test('first placement undo removes blank attempt; redo preserves ID',C=>{
 const p=puzzle(C);C.S.mode='solve';C.L.openPuzzleBoard(p,'BLANK');C.L.placeElement(1,1,'mirrorDiag',false);const sid=C.S.currentSolutionId;
 C.L.stepEditHistory(-1);assert.equal(C.S.currentSolutionId,'BLANK');assert.equal(C.S.solutions.some(s=>s.id===sid),false);assert.equal(btn(C,'redo').disabled,false);
 C.L.stepEditHistory(1);assert.equal(C.S.currentSolutionId,sid);assert.equal(C.L.getCurrentSolution().elements.length,1);assert.equal(C.S.solutions.filter(s=>s.id===sid).length,1);
 C.L.stepEditHistory(-1);assert.equal(JSON.parse(C.w.localStorage.getItem('lightyard_data')).solutions.some(s=>s.id===sid),false);
});
test('a new edit after undoing to blank creates no orphan or duplicate attempt',C=>{
 const p=puzzle(C);C.S.mode='solve';C.L.openPuzzleBoard(p,'BLANK');C.L.placeElement(1,1,'mirrorDiag',false);const first=C.S.currentSolutionId;
 C.L.stepEditHistory(-1);C.L.placeElement(2,2,'prism',false);const second=C.S.currentSolutionId;assert.notEqual(first,second);assert.equal(btn(C,'redo').disabled,true);
 C.L.stepEditHistory(-1);assert.equal(C.S.solutions.filter(s=>s.puzzleId===p.id).length,0);C.L.stepEditHistory(1);assert.equal(C.S.currentSolutionId,second);assert.equal(C.S.solutions.filter(s=>s.puzzleId===p.id).length,1);
});
test('new edits replace redo; no-op configuration preserves it',C=>{
 const p=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'mirrorDiag',true);C.L.placeElement(2,2,'prism',true);
 C.L.stepEditHistory(-1);C.L.selectCell(1,1);C.L.mutateSelectedConfig(e=>e.orientation='NE_SW');assert.equal(btn(C,'redo').disabled,false);C.L.placeElement(3,3,'crystal',true);assert.equal(btn(C,'redo').disabled,true);assert.equal(C.L.stepEditHistory(1),false);
});
test('native text and modal undo stay separate; Mac and Windows shortcuts work',C=>{
 const p=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'mirrorDiag',true);C.L.showPuzzleSetupDialog(p);
 assert.equal(key(C,'z',{},C.w.document.querySelector('#setupIntro')).defaultPrevented,false);assert.equal(key(C,'z').defaultPrevented,false);assert.equal(p.elements.length,1);C.w.document.querySelector('[data-act=cancel]').click();
 key(C,'z');assert.equal(p.elements.length,0);key(C,'z',{shiftKey:true});assert.equal(p.elements.length,1);key(C,'z',{metaKey:false,ctrlKey:true});assert.equal(p.elements.length,0);key(C,'y',{metaKey:false,ctrlKey:true});assert.equal(p.elements.length,1);
});
test('drag, Alt-drag, clone and eraser each undo once',C=>{
 const p=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'mirrorDiag',true);
 const canvas=C.w.document.querySelector('canvas');canvas._cell=20;canvas.getBoundingClientRect=()=>({left:0,top:0,width:140,height:140});
 const pointer=(target,type,r,c,altKey=false)=>{const e=new C.w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:c*20+10,clientY:r*20+10,altKey});Object.defineProperty(e,'pointerId',{value:7});target.dispatchEvent(e);};
 const drag=(from,to,alt)=>{canvas._cell=20;pointer(canvas,'pointerdown',...from);pointer(C.w,'pointermove',...to,alt);pointer(C.w,'pointerup',...to,alt);};
 drag([1,1],[2,2],false);assert.equal(p.elements[0].r,2);C.L.stepEditHistory(-1);assert.equal(p.elements[0].r,1);C.L.stepEditHistory(1);
 drag([2,2],[3,3],true);assert.equal(p.elements.length,2);C.L.stepEditHistory(-1);assert.equal(p.elements.length,1);
 C.S.cloneSource=clone(p.elements[0]);C.L.cloneElementTo(4,4);assert.equal(p.elements.length,2);C.L.stepEditHistory(-1);assert.equal(p.elements.length,1);C.L.removeElementAt(2,2);C.L.stepEditHistory(-1);assert.equal(p.elements.length,1);
});
test('setup shrink and restrictions restore saved solution pieces and metrics',C=>{
 const p=puzzle(C,{elements:[{type:'mirrorDiag',r:6,c:6,orientation:'NE_SW'}]});const s=solution(C,p,{elements:[{type:'prism',r:1,c:1,base:'E',seq:[null,null,null]},{type:'mirrorDiag',r:6,c:5,orientation:'NE_SW'}],status:'solved',ticksToSolve:42,solvedAt:123});const original=clone({p,s});
 C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.showPuzzleSetupDialog(p);C.w.document.querySelector('#setupRows').value='5';C.w.document.querySelector('#setupCols').value='5';C.w.document.querySelector('#setupIncludePrisms').checked=false;C.w.document.querySelector('#setupName').value='Changed';C.w.document.querySelector('[data-act=save]').click();
 assert.equal(p.rows,5);assert.equal(s.status,'in-progress');assert.equal(s.elements.length,0);C.L.stepEditHistory(-1);assert.deepEqual(clone({p,s}),original);C.L.stepEditHistory(1);assert.equal(p.name,'Changed');assert.equal(s.elements.length,0);
});
test('undo fixed placement restores overwritten solution and solved state',C=>{
 const p=puzzle(C);const s=solution(C,p,{elements:[{type:'mirrorDiag',r:1,c:1,orientation:'NE_SW'}],status:'solved',ticksToSolve:10});C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'crystal',true);assert.equal(s.elements.length,0);
 C.L.stepEditHistory(-1);assert.equal(s.elements.length,1);assert.equal(s.status,'solved');assert.equal(s.ticksToSolve,10);C.L.stepEditHistory(1);assert.equal(s.elements.length,0);
});
test('Arrange shares undo/redo with board controls and keyboard',C=>{
 const p=puzzle(C,{elements:[{type:'emitter',r:1,c:2,dirs:['E'],colors:[1]}]});const s=solution(C,p,{elements:[{type:'mirrorDiag',r:2,c:3,orientation:'NE_SW'}],status:'solved',ticksToSolve:9});const original=clone({p,s});C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.showPuzzleArrangeDialog(p);C.w.document.querySelector('[data-arrange=right]').click();const arranged=clone({p,s});
 assert.notDeepEqual(arranged,original);key(C,'z');assert.deepEqual(clone({p,s}),original);assert.equal(C.w.document.querySelector('.arrange-dialog [data-act=redo]').disabled,false);C.w.document.querySelector('.arrange-dialog [data-act=redo]').click();assert.deepEqual(clone({p,s}),arranged);C.w.document.querySelector('[data-act=done]').click();C.L.stepEditHistory(-1);assert.deepEqual(clone({p,s}),original);C.L.stepEditHistory(1);assert.deepEqual(clone({p,s}),arranged);
});
test('named blank attempts undo and redo',C=>{
 const p=puzzle(C);C.S.mode='solve';C.L.openPuzzleBoard(p,'BLANK');C.L.showSolutionSetupSheet();C.w.document.querySelector('#solutionSetupName').value='Named';C.w.document.querySelector('#saveSolutionSetup').click();const sid=C.S.currentSolutionId;assert.equal(C.L.getCurrentSolution().name,'Named');C.L.stepEditHistory(-1);assert.equal(C.L.getCurrentSolution().id,'BLANK');C.L.stepEditHistory(1);assert.equal(C.L.getCurrentSolution().id,sid);assert.equal(C.L.getCurrentSolution().name,'Named');
});
test('undo clears unfinished playback; solved solutions remain locked',C=>{
 const p=puzzle(C);C.S.mode='solve';C.L.openPuzzleBoard(p,'BLANK');C.L.placeElement(1,1,'mirrorDiag',false);C.L.placeElement(2,2,'prism',false);C.S.runStarted=true;C.S.running=true;C.S.tick=8;C.S.frac=.5;C.L.stepEditHistory(-1);assert.equal(C.S.tick,0);assert.equal(C.S.runStarted,false);assert.equal(C.S.running,false);assert.equal(C.L.getCurrentSolution().elements.length,1);
 const s=C.L.getCurrentSolution();s.status='solved';s.ticksToSolve=9;C.L.persistData();C.L.renderScreen();assert.equal(C.L.stepEditHistory(-1),false);assert.equal(s.status,'solved');assert.equal(btn(C,'undo').disabled,true);
});
test('histories survive navigation without crossing document boundaries',C=>{
 const a=puzzle(C),b=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(a,null);C.L.placeElement(1,1,'mirrorDiag',true);C.L.openPuzzleBoard(b,null);assert.equal(C.L.stepEditHistory(-1),false);C.L.placeElement(2,2,'prism',true);C.L.openPuzzleBoard(a,null);C.L.stepEditHistory(-1);assert.equal(a.elements.length,0);assert.equal(b.elements.length,1);
 C.S.mode='solve';C.L.openPuzzleBoard(a,'BLANK');C.L.placeElement(3,3,'mirrorDiag',false);const sid=C.S.currentSolutionId;C.L.openPuzzleBoard(b,'BLANK');assert.equal(C.L.stepEditHistory(-1),false);C.L.openPuzzleBoard(a,sid);C.L.stepEditHistory(-1);assert.equal(C.L.getCurrentSolution().id,'BLANK');assert.equal(b.elements.length,1);
});
test('external changes invalidate conflicting history; New Solution starts fresh',C=>{
 const p=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'mirrorDiag',true);solution(C,p);assert.equal(C.L.stepEditHistory(-1),false);assert.equal(p.elements.length,1);C.L.placeElement(2,2,'prism',true);C.L.stepEditHistory(-1);assert.equal(p.elements.length,1);
 C.S.mode='solve';C.L.openPuzzleBoard(p,'BLANK');C.L.placeElement(3,3,'mirrorDiag',false);C.L.stepEditHistory(-1);C.L.newBlankSolution();assert.equal(C.L.stepEditHistory(1),false);
});
test('per-document history retains at most 100 edits',C=>{
 const p=puzzle(C);C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'mirrorDiag',true);for(let i=0;i<110;i++)C.L.mutateSelectedConfig(e=>e.orientation=e.orientation==='NE_SW'?'NW_SE':'NE_SW');assert.equal(C.L.getHistory().frames.length,101);let n=0;while(C.L.stepEditHistory(-1))n++;assert.equal(n,100);
});
test('Save as Web App preserves controls, catalog and progress namespace',C=>{
 const p=puzzle(C,{elements:[{type:'emitter',r:2,c:0,dirs:['E'],colors:[1]},{type:'receiver',r:2,c:6,dirs:['W'],colors:[1]}]});C.S.mode='create';C.L.openPuzzleBoard(p,null);C.L.placeElement(1,1,'mirrorDiag',true);const html=C.L.exportHTML();assert.ok(html.includes('function stepEditHistory'));assert.ok(html.includes('app-lightyard-public'));
 const E=open(html);try{const p2=E.S.builtInPuzzles.find(x=>x.name===p.name);assert.ok(p2);E.S.mode='solve';E.L.openPuzzleBoard(p2,'BLANK');E.L.placeElement(3,3,'mirrorDiag',false);assert.equal(btn(E,'undo').disabled,false);E.L.stepEditHistory(-1);assert.equal(E.L.getCurrentSolution().id,'BLANK');assert.deepEqual(E.errors,[]);}finally{E.dom.window.close();}
});
console.log(`${passed} undo/redo checks passed`);
