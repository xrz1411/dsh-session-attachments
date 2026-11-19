import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSessionPaste, bindSessionRow, bindSessionInput, installSessionInput} from '../input.mjs';
const uuid='8c599d28-3ed8-4915-b0d0-73d8b101aa2c';
const targetSessionId='current';
const known={sessionId:'import-id',title:'Saved'};
const lookup=id=>id===known.sessionId?known:undefined;
function paste(text,more={}) { return {clipboardData:{getData:()=>text,types:['text/plain'],...more}, preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}} }
function fixture(resolve) {
  let span={start:2,end:5,draftRev:1};
  const calls=[], notes=[];
  return {calls, notes, notify:(...args)=>notes.push(args), issue:row=>row.sessionId===targetSessionId?'self':null, lookup,resolve,targetSessionId,active:()=>true,signal:new AbortController().signal,
    insert:(...args)=>{calls.push(args);return true},inputActions:{captureInsertion:()=>span,
    insertText:(s,b)=>{assert.equal(span,b);calls.push(s);span={start:2+s.length,end:2+s.length,draftRev:2};return true}},
    move:()=>{span={...span,start:0,end:0}}, edit:()=>{span={...span,draftRev:3}}};
}
test('only exact known identities become session chips; no changes for ordinary/file/self paste',()=>{
  const f=fixture();const e=paste(' import-id ');handleSessionPaste(e,f);assert.deepEqual(f.calls,[[known]]);assert.ok(e.stopped);
  for (const event of [paste('ordinary'),paste('two\nimport-id'),paste('current'),paste('import-id',{files:[{}]}),paste('import-id',{items:[{kind:'file'}]}),paste('import-id',{types:['Files']})]) {
    handleSessionPaste(event,f);assert.ok(!event.defaultPrevented);
  } assert.equal(f.calls.length,1);assert.deepEqual(f.notes,[['attached'],['self',true]]);
  const blocked=paste('import-id');handleSessionPaste(blocked,{...f,insert:()=>false});assert.ok(!blocked.defaultPrevented);
  assert.deepEqual(f.notes.at(-1),['draftChanged',true]);
  for (const reason of ['duplicate','limit','targetUnavailable','sourceBlank']) {
    const e=paste('import-id');handleSessionPaste(e,{...f,issue:()=>reason});assert.ok(!e.defaultPrevented);assert.deepEqual(f.notes.at(-1),[reason,true]);
  }
  assert.equal(f.calls.length,1);
});
const tick=()=>new Promise(done=>setImmediate(done));
test('cold lookup inserts ordinary text immediately; replaces only exact identity at revision-guarded range',async()=>{
  const candidate={sessionId:uuid,title:'resolved'};const f=fixture(async()=>candidate);const e=paste(uuid);handleSessionPaste(e,f);
  assert.deepEqual(f.calls,[uuid]);assert.ok(e.defaultPrevented);await tick();assert.deepEqual(f.calls,[uuid,[candidate,{start:2,end:2+uuid.length,draftRev:2}]]);
});
test('unresolved, mismatched, edited or unmounted cold lookup leaves pasted text intact',async()=>{
  for(const mode of ['unresolved','mismatch','edited','moved','unmounted','aborted','failed']) {
    const f=fixture(async()=>{if(mode==='failed')throw Error('offline');return mode==='unresolved'?null:{sessionId:mode==='mismatch'?'other':uuid}});
    const ctrl=new AbortController();f.signal=ctrl.signal;
    let mounted=true;f.active=()=>mounted;
    handleSessionPaste(paste(uuid),f);if(mode==='edited')f.edit();if(mode==='moved')f.move();if(mode==='aborted')ctrl.abort();if(mode==='unmounted')mounted=false;
    await tick();assert.deepEqual(f.calls,[uuid]);assert.deepEqual(f.notes,mode==='failed'?[['lookupFailed',true]]:[]);
  }
});
function node() {
  const handlers=new Map();return {addEventListener(type,fn,opts){handlers.set(type,fn);opts.signal.addEventListener('abort',()=>handlers.delete(type))},fire:(t,e)=>handlers.get(t)?.(e)};
}
test('sidebar-owned private drag targets only its destination pane, never other text, files, or reorders; disposes listeners',()=>{
  const region=node(),doc=node(),card=node(),editor={focus(){editor.focused=true}};let editable=true;
  const anchor={closest:()=>card};card.ownerDocument=doc;card.closest=()=>region;region.getAttribute=()=>targetSessionId;card.querySelector=()=>editable?editor:null;
  let dragged=known.sessionId, calls=[],notes=[],hover=false,reason=null;
  const dispose=bindSessionInput({anchor,targetSessionId,inputActions:{},lookup,issue:()=>reason,notify:key=>notes.push(key),insert:s=>{calls.push(s);return true},currentDrag:()=>dragged,setHover:v=>{hover=v}});
  const make=()=>({target:{closest:()=>region},dataTransfer:{types:['application/x-dsh-session-attachment'],getData:()=>known.sessionId},preventDefault(){this.claim=true},stopPropagation(){}});
  const ok=make();region.fire('dragover',ok);assert.ok(hover&&ok.claim);assert.equal(ok.dataTransfer.dropEffect,'copy');region.fire('drop',ok);assert.deepEqual(calls,[known]);assert.ok(editor.focused&&!hover);
  assert.deepEqual(notes,['attached']);
  for(const key of ['duplicate','limit','self','sourceBlank','sourceMissing','targetLocked','targetUnavailable']) {
    const e=make();reason=key==='targetUnavailable'?null:key;editable=key!=='targetUnavailable';
    region.fire('dragover',e);assert.equal(hover,key);assert.equal(e.dataTransfer.dropEffect,'none');region.fire('drop',e);assert.equal(notes.at(-1),key);assert.equal(calls.length,1);
  }
  editable=true;reason=null;const changed=make();region.fire('dragenter',changed);assert.equal(hover,'hover');reason='limit';region.fire('drop',changed);assert.equal(notes.at(-1),'limit');assert.equal(calls.length,1);
  reason=null;region.fire('dragover',make());doc.fire('dragend',{});assert.ok(!hover);
  for(const mode of ['external','sibling','files','reorder','wrong-payload']) {
    const e=make();dragged=mode==='external'?null:known.sessionId;
    if(mode==='sibling')e.target.closest=()=>({});if(mode==='files')e.dataTransfer.files=[{}];if(mode==='reorder')e.dataTransfer.types=['text/plain'];if(mode==='wrong-payload')e.dataTransfer.getData=()=> 'other';region.fire('drop',e);assert.ok(!e.claim);
  }
  dispose();editable=true;region.fire('drop',make());assert.equal(calls.length,1);
});
function dragRow(doc=node()) {
  const row=node(), sibling={}, tree={contains:n=>n===row||n===sibling};
  doc.defaultView={DragEvent:class {constructor(type){this.type=type}}};
  Object.assign(row,{ownerDocument:doc,draggable:true,isConnected:true,closest:()=>tree,getAttribute:()=>`session:${known.sessionId}`});
  const data=new Map();
  const start={target:row,dataTransfer:{get types(){return [...data.keys()]},setData:(k,v)=>data.set(k,v),getData:k=>data.get(k)}};
  return {row,doc,sibling,start};
}

test('native sidebar drop commits once; cross-pane or cancelled drag never commits a stale hover marker',()=>{
  for (const mode of ['list','chat','cancel','workspace-header','other-account','wrong-pinned-block']) {
    const {row,doc,sibling,start}=dragRow(), active=[];
    let committed=false;const orders=[];
    // Mirror WorkspaceBrowser: mark committed even when a self-drop doesn't
    // write an order. Its dragend fallback then ignores the old hover marker.
    const commit=target=>{if(!committed){committed=true;if(target!==row)orders.push(target)}};
    row.dispatchEvent=e=>{assert.equal(e.type,'drop');commit(row)};
    const dispose=bindSessionRow(row,known.sessionId,id=>active.push(id));
    row.fire('dragstart',start);
    // Host React handler runs at its root before the document bubble listener.
    start.dataTransfer.effectAllowed='move';start.dataTransfer.setData('text/plain',known.sessionId);
    doc.fire('dragstart',start);assert.equal(start.dataTransfer.effectAllowed,'copyMove');
    assert.equal(start.dataTransfer.getData('application/x-dsh-session-attachment'),known.sessionId);
    if(mode!=='cancel')doc.fire('drop',{target:mode==='list'?sibling:{}});
    if(mode==='list')commit(sibling);
    row.fire('dragend',{});commit(sibling); // Host falls back to last hovered sibling.
    assert.deepEqual(orders,mode==='list'?[sibling]:[]);
    assert.deepEqual(active,[known.sessionId,undefined]);dispose();
  }
});

test('non-reorderable rows may attach without starting a sort or changing controls',()=>{
  const {doc,row,start}=dragRow(),active=[];row.draggable=false;
  const dispose=bindSessionRow(row,known.sessionId,id=>active.push(id));
  row.fire('pointerdown',{button:0,target:{closest:()=>({})}});assert.equal(row.draggable,false);
  row.fire('pointerdown',{button:0,target:{closest:()=>null}});assert.equal(row.draggable,true);
  row.fire('dragstart',start);doc.fire('drop',{target:{}});row.fire('dragend',{});
  assert.equal(row.draggable,false);assert.deepEqual(active,[known.sessionId,undefined]);dispose();
});

test('overlay guides a drag from the sidebar, translates refusal, then confirms only a successful drop',()=>{
  const slots={},labels={'local.session-attachments':{zh:{duplicate:'已添加过此会话'}}};
  const ctx={effect:fn=>fn(),locale:{register:(ns,langs)=>{labels[ns]=langs},bind:ns=>key=>labels[ns].zh[key]},get:()=>({list:{getSnapshot:()=>({byId:{[known.sessionId]:known}})}}),slots:{inject:(_,cb)=>cb(),register:(opts,component)=>{slots[opts.name]=component}}};
  const region=node(),doc=node(),card=node(),editor={focus(){}};
  card.ownerDocument=doc;card.closest=()=>region;card.querySelector=()=>editor;region.getAttribute=()=>targetSessionId;
  const ref={current:{closest:()=>card}}, states=[];let i=0,effect;
  const React={createElement:(tag,props,...children)=>({tag,props,children}),useRef:()=>ref,useState:initial=>{const n=i++;if(!(n in states))states[n]=initial;return [states[n],v=>{states[n]=v}]},useLayoutEffect:fn=>{effect=fn}};
  let reason='duplicate',inserts=0;
  installSessionInput({ctx,React,insertSessionAttachment:()=>{inserts++;return true},attachmentIssue:()=>reason});
  const render=()=>{i=0;return slots['conversation.input.overlay']({sessionId:targetSessionId,inputActions:{}})};
  assert.ok(render().props.hidden);const cleanup=effect();
  try {
    const {row,start}=dragRow();ref.current={closest:()=>row};
    const marker=slots['sidebar.workspaces.session.row.action']({sessionId:known.sessionId});assert.ok(marker.props.hidden);assert.deepEqual(marker.children,[]);
    const removeRow=effect();row.fire('dragstart',start);assert.match(render().children[0],/右侧聊天区/);
    const e={target:{closest:()=>region},preventDefault(){},stopPropagation(){},dataTransfer:start.dataTransfer};
    region.fire('dragenter',e);assert.equal(render().children[0],'已添加过此会话');assert.equal(e.dataTransfer.dropEffect,'none');
    reason=null;region.fire('dragover',e);assert.match(render().children[0],/松手/);region.fire('drop',e);removeRow();
    assert.equal(inserts,1);assert.match(render().children[0],/添加到草稿/);
  } finally {cleanup()}
});
