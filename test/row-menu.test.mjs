import test from 'node:test';
import assert from 'node:assert/strict';
import {installRowMenu} from '../row-menu.mjs';

function fixture(doc) {
  let Anchor, definition, ref, cleanup, issue = null, inserted = true, visible = true, editable = true;
  const notices = [], writes = [], dict = {}, active = {props:{}}, layout = {activePanelId:null};
  const effects = [];
  const ctx = {
    effect(fn) { effects.push(fn()); },
    locale:{register(ns, messages){dict[ns] = messages.zh; return () => delete dict[ns];}, bind:ns => k => dict[ns]?.[k] ?? k},
    layout:{panelInfo:{getSnapshot:() => layout}}, uiSession:{adapter:{current:{getSnapshot:() => active}}},
    slots:{inject:(_slot, fn) => fn(), register(spec, Comp){if(spec.name==='contextMenu.icon'){assert.equal(spec.key,'local.session-attachments.add-to-chat'); return;} assert.equal(spec.name,'conversation.input.overlay'); Anchor=Comp;}},
    contextMenus:{register(d){assert.equal(d.target,'session'); definition=d; return () => {definition=null;};},notify:(...args) => notices.push(args)},
  };
  const React = {useRef:() => ({current:ref}),useLayoutEffect:f => {cleanup=f();},createElement:() => null};
  installRowMenu({ctx, React, attachmentIssue:() => issue, insertSessionAttachment(c, target, source){assert.equal(c,ctx);writes.push([target,source]);return inserted;}});
  function mount(id) {
    cleanup?.();
    const card = {ownerDocument:doc,isConnected:true, closest:() => ({getAttribute:() => id}), querySelector:() => editable ? {closest:() => null,checkVisibility:() => visible} : null};
    ref = {closest:() => card};
    active.props = {sessionId:id, inputActions:{captureInsertion(){}}};
    Anchor(active.props);
  }
  return {active,layout,writes,notices,mount,open:id => definition.resolve({sessionId:id,displayTitle:'irrelevant'})[0],
    reject:key => {issue=key;},fail:() => {inserted=false;},hide:() => {visible=false;},lock:() => {editable=false;},dispose:() => effects.reverse().forEach(f => f())};
}

test('原生 session 菜单把点击行作为来源，仅调用活动目标的草稿插入', () => {
  const f=fixture(); f.mount('current'); const action=f.open('clicked');
  assert.equal(action.label,'添加到当前聊天'); assert.equal(action.icon.key,'local.session-attachments.add-to-chat'); action.run();
  assert.equal(f.writes.length,1); const [[target,source]]=f.writes; assert.equal(typeof target.afterInsertFocus,'function'); assert.equal(target.targetSessionId,'current'); assert.equal(target.inputActions,f.active.props.inputActions); assert.deepEqual(source,{sessionId:'clicked'});
  assert.deepEqual(f.notices,[['已将会话添加到当前聊天的草稿。',true]]); f.dispose();
});

test('菜单打开后换聊天、切面板或原本没有活动目标都不插入', () => {
  for (const mode of ['switched','panel','absent']) {
    const f=fixture(); if(mode!=='absent') f.mount('first'); const action=f.open('source');
    if(mode==='panel') f.layout.activePanelId='files'; else f.mount('second');
    action.run();assert.deepEqual(f.writes,[]);assert.equal(f.notices[0][1],false);
    assert.equal(f.notices[0][0],mode==='absent'?'targetUnavailable':'当前聊天已改变，请重新打开会话菜单。');
  }
});

test('选择时重新检查拒绝原因；编辑器不可见或锁定也不得写入', () => {
  for(const key of ['self','duplicate','limit','sourceMissing','sourceBlank','targetUnavailable','targetLocked','hidden','locked']) {
    const f=fixture(); f.mount('target'); const action=f.open('source');
    if(key==='hidden') f.hide(); else if(key==='locked') f.lock(); else f.reject(key);
    action.run(); assert.deepEqual(f.notices,[[['hidden','locked'].includes(key)?'targetLocked':key,false]]);assert.deepEqual(f.writes,[]);
  }
});

test('菜单退场后归焦，主动交互或切换聊天则不抢焦点', () => {
  for(const mode of ['normal','interacted','switched']) {
    let changed,frame,calls=0; const popup={isConnected:true}; const doc=new EventTarget();
    doc.activeElement={closest:()=>popup}; doc.defaultView={MutationObserver:class{constructor(fn){changed=fn;} observe(){} disconnect(){}},setTimeout,clearTimeout,requestAnimationFrame:fn=>{frame=fn;}};
    const f=fixture(doc); f.mount('current'); f.open('source').run();
    f.writes[0][0].afterInsertFocus(()=>calls++); popup.isConnected=false; changed();
    if(mode==='interacted')doc.dispatchEvent(new Event('keydown')); if(mode==='switched')f.mount('other'); frame();
    assert.equal(calls,mode==='normal'?1:0);
  }
});

test('插入被草稿版本检查拒绝时反馈失败而不是成功', () => {
  const f=fixture(); f.mount('current'); const action=f.open('source'); f.fail(); action.run();
  assert.deepEqual(f.notices,[['draftChanged',false]]);
});
