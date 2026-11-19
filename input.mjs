const mime = 'application/x-dsh-session-attachment';
const content = '[data-conversation-content]';
const cardSelector = '[data-composer-card]';
const editorSelector = '[data-composer-input][contenteditable="true"]:not([data-composer-composing])';
const looksLikeId = /^(?:session-)?[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const hasFiles = data => data && (data.files?.length > 0 || Array.from(data.types || []).includes('Files') || Array.from(data.items || []).some(item => item.kind === 'file'));

// The synchronous path only recognizes exact identities from this client's
// session index. An unknown UUID is pasted as text immediately; the resolver
// may later replace that exact range, but never after a subsequent edit.
export function handleSessionPaste(event, {lookup, resolve, insert, issue, notify, inputActions, targetSessionId, signal, active}) {
  const data = event.clipboardData;
  if (!data || event.defaultPrevented || hasFiles(data)) return;
  const raw = data.getData('text/plain');
  const id = raw.trim();
  if (!id || /[\r\n]/.test(id)) return;
  const candidate = lookup(id) || (id === targetSessionId && {sessionId:id});
  const claim = () => { event.preventDefault(); event.stopPropagation(); };
  const attach = (row, span) => {
    const reason = issue(row);
    if (!reason && (span ? insert(row, span) : insert(row))) { notify('attached'); return true; }
    notify(reason || issue(row) || 'draftChanged', true);
    return false;
  };
  if (candidate) {
    if (attach(candidate)) claim();
    return;
  }
  if (raw !== id || !looksLikeId.test(id) || !resolve) return;
  const before = inputActions.captureInsertion();
  if (!inputActions.insertText(raw, before)) return;
  claim();
  const after = inputActions.captureInsertion();
  if (after.start !== after.end || after.end !== before.start + raw.length || after.draftRev <= before.draftRev) return;
  const span = {start: before.start, end: after.end, draftRev: after.draftRev};
  const unchanged = () => {
    if (signal.aborted || !active()) return false;
    const now = inputActions.captureInsertion();
    return now.draftRev === after.draftRev && now.start === after.start && now.end === after.end;
  };
  Promise.resolve().then(() => signal.aborted ? undefined : resolve(id, signal)).then(row => {
    if (!unchanged()) return;
    if (row?.sessionId === id) attach(row, span);
    // Unknown UUIDs are ordinary text, not a failed attachment attempt.
  }, () => { if (unchanged()) notify('lookupFailed', true); });
}

export function bindSessionInput({anchor, targetSessionId, inputActions, lookup, resolve, insert, issue, notify, currentDrag, setHover}) {
  const card = anchor.closest(cardSelector);
  const region = card?.closest(content);
  if (!region || region.getAttribute('data-conversation-session') !== targetSessionId) return;
  const controller = new AbortController();
  const {signal} = controller;
  const opts = {capture: true, signal};
  const editable = () => card.querySelector(editorSelector);
  const inside = e => e.target?.closest?.(content) === region;
  const source = e => {
    const id = currentDrag();
    if (!id || !inside(e) || hasFiles(e.dataTransfer) || !Array.from(e.dataTransfer?.types || []).includes(mime)) return;
    return lookup(id) || {sessionId:id};
  };
  const preflight = candidate => issue(candidate) || (!editable() ? 'targetUnavailable' : null);
  const over = e => {
    const candidate = source(e);
    if (!candidate) return;
    const reason = preflight(candidate);
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = reason ? 'none' : 'copy'; setHover(reason || 'hover');
  };
  const clear = () => setHover(null);
  region.addEventListener('dragenter', over, opts);
  region.addEventListener('dragover', over, opts);
  region.addEventListener('dragleave', e => { if (e.relatedTarget?.closest?.(content) !== region) clear(); }, opts);
  card.ownerDocument.addEventListener('dragend', clear, opts);
  region.addEventListener('drop', e => {
    clear();
    const candidate = source(e);
    if (!candidate || e.dataTransfer.getData(mime) !== candidate.sessionId) return;
    e.preventDefault(); e.stopPropagation();
    const reason = preflight(candidate);
    if (reason || !insert(candidate)) { notify(reason || preflight(candidate) || 'draftChanged'); return; }
    notify('attached'); editable()?.focus({preventScroll: true});
  }, opts);
  card.addEventListener('paste', e => {
    if (!inside(e) || e.target?.closest?.('[data-composer-input]') !== editable() || !editable()) return;
    handleSessionPaste(e, {lookup, resolve, insert, issue, notify, inputActions, targetSessionId, signal, active: () => !!editable() && card.isConnected});
  }, opts);
  return () => { controller.abort(); };
}

// Bind through the row slot so IDs come from the host, not text/plain or DOM
// supplied by an unrelated drag source. No extra visible control or hit area.
export function bindSessionRow(row, sessionId, setDrag) {
  const controller = new AbortController();
  const opts = {signal:controller.signal, capture:true};
  const doc = row.ownerDocument;
  let gesture, temporary = false;
  const restore = () => { if (temporary) { row.draggable = false; temporary = false; } };
  const control = 'a,button,input,textarea,select,[contenteditable="true"],[role="button"]';
  row.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest(control) || row.draggable) return;
    // Non-reorderable rows still support attaching. Retain their original
    // behavior outside this gesture, including keyboard/menu interaction.
    temporary = true; row.draggable = true;
  }, opts);
  const pointerUp = () => { if (!gesture) restore(); };
  row.addEventListener('pointerup', pointerUp, opts);
  row.addEventListener('pointerleave', pointerUp, opts);
  row.addEventListener('pointercancel', pointerUp, opts);
  const finish = () => {
    if (gesture) { gesture.abort(); gesture = undefined; setDrag(undefined); }
    restore();
  };
  row.addEventListener('dragstart', e => {
    if (e.target !== row || !e.dataTransfer || e.defaultPrevented) return;
    gesture = new AbortController();
    const signal = gesture.signal;
    const native = !temporary;
    let neutralized = false;
    // rc.5 WorkspaceBrowser commits drag.over on dragend. Both tree and flat
    // views explicitly ignore a drop on the source *after* marking the drag
    // committed and clearing it. Use that no-op; never write/restore a stale
    // order snapshot or suppress the host's dragend (which clears its preview).
    const cancelReorder = () => {
      if (!native || neutralized || !row.isConnected) return;
      neutralized = true;
      row.dispatchEvent(new doc.defaultView.DragEvent('drop', {bubbles:true, cancelable:true}));
    };
    row.addEventListener('dragend', () => {
      // The real drop has already run. A valid sidebar drop committed via the
      // host and this is inert; everywhere else (including another account,
      // an incompatible pinned block, Esc or a rejected chat) discard hover.
      cancelReorder();
      finish();
    }, {signal, capture:true});
    // React's native row handler writes 'move' and text/plain at its root.
    // Widen the allowed operations afterwards, while dragstart is writable.
    doc.addEventListener('dragstart', start => {
      if (start !== e) return;
      start.dataTransfer.effectAllowed = 'copyMove';
    }, {signal, once:true});
    e.dataTransfer.setData(mime, sessionId);
    e.dataTransfer.effectAllowed = 'copyMove';
    setDrag(sessionId);
  }, opts);
  return () => { controller.abort(); finish(); };
}

export function installSessionInput({ctx, React, insertSessionAttachment, attachmentIssue}) {
  const ns = 'session-attachments-input';
  ctx.effect(() => ctx.locale.register(ns, {
    en: {handle: 'Drag this session to the chat area on the right to attach it', hover: 'Release to attach this session', attached: 'Session added to the draft', kept: 'Pasted as text.', lookupFailed: 'Could not check the session ID.'},
    zh: {handle: '将此会话拖到右侧聊天区即可添加附件', hover: '松手添加此会话', attached: '已将会话添加到草稿', kept: '已保留粘贴的文本。', lookupFailed: '暂时无法验证会话 ID。'},
  }), 'session attachments: gesture labels');
  const t = ctx.locale.bind(ns);
  const reasonText = ctx.locale.bind('local.session-attachments');
  const message = key => ['hover','handle','attached','lookupFailed'].includes(key) ? t(key) : reasonText(key);
  const dragHints = new Set();
  const sessions = ctx.get('sessions');
  const lookup = id => {
    const byId = sessions.list.getSnapshot().byId;
    const row = Object.hasOwn(byId, id) && byId[id];
    return row ? {sessionId: id, title: row.displayTitle || row.title || id} : undefined;
  };
  let dragged;
  function RowSource({sessionId}) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => {
      const row = ref.current?.closest('[role="treeitem"][data-row-key]');
      if (row?.getAttribute('data-row-key') !== 'session:' + sessionId) return;
      return bindSessionRow(row, sessionId, id => {
        dragged = id; for (const hint of dragHints) hint(!!id);
      });
    }, [sessionId]);
    return React.createElement('span', {ref, hidden:true, 'aria-hidden':true});
  }
  function Overlay({sessionId, inputActions}) {
    const ref = React.useRef(null);
    const [hover, setHover] = React.useState(null);
    const [notice, setNotice] = React.useState('');
    const [dragging, setDragging] = React.useState(false);
    React.useLayoutEffect(() => {
      setHover(null); setNotice(''); setDragging(!!dragged);
      if (!ref.current || !inputActions) return;
      let timer;
      const notify = (key, kept) => {
        clearTimeout(timer);
        setNotice(message(key) + (kept ? ' ' + t('kept') : ''));
        timer = setTimeout(() => setNotice(''), 4500);
      };
      const hint = active => { setDragging(active); if (active) setNotice(''); else setHover(null); };
      dragHints.add(hint);
      const resolve = async (id, signal) => {
        const result = await ctx.remote.sessionReferenceResolver.candidates(sessionId, id, signal);
        if (!result.ok) throw new Error('Session lookup unavailable');
        const row = result.value.find(c => c.sessionId === id);
        return row && {sessionId:id, title:row.displayTitle || row.label || id, verified:true};
      };
      const dispose = bindSessionInput({anchor:ref.current, targetSessionId:sessionId, inputActions, lookup, resolve, notify,
        issue:candidate => attachmentIssue(ctx,sessionId,candidate),
        insert:(candidate, span) => insertSessionAttachment(ctx,{targetSessionId:sessionId,inputActions},candidate,span),
        currentDrag:() => dragged, setHover});
      return () => { dispose?.(); clearTimeout(timer); dragHints.delete(hint); };
    }, [sessionId, inputActions]);
    const text = hover ? message(hover) : notice || (dragging ? t('handle') : '');
    return React.createElement('span', {ref, hidden:!text, role:'status', style:text ? {position:'absolute', bottom:'100%', left:'50%', transform:'translateX(-50%)', pointerEvents:'none', width:'max-content', maxWidth:'min(90vw, 34em)', textAlign:'center', padding:'5px 10px', border:'1px solid currentColor', borderRadius:8, background:'Canvas', color:'CanvasText', zIndex:2} : undefined}, text || null);
  }
  for (const [slot, component] of [['conversation.input.overlay',Overlay],['sidebar.workspaces.session.row.action',RowSource]]) {
    ctx.slots.inject(slot, () => ctx.slots.register({name:slot, id:'session-attachment-input', order:50}, component));
  }
}
