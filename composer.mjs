// The composer owns the editor and submission. Insert the same atomic node as its
// built-in @ picker; only the Host resolves the mention into model context.
function sessionKey(id) {
  const bytes = new TextEncoder().encode(JSON.stringify(id));
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function attachmentTarget(ctx, id) {
  const binding = ctx.sessions.binding(id);
  if (!binding) return { issue: 'targetUnavailable' };
  const state = binding.session.getSnapshot();
  if (state.removed || (state.subagent && state.subagent.address.mode !== 'continuable')) return { issue: 'targetUnavailable' };
  if (ctx.conversation.blocks.storeFor(id).getSnapshot()) return { issue: 'targetLocked' };
  const input = ctx.conversation.input.for(binding.ctx);
  const draft = input.state.getSnapshot();
  return draft.phase !== 'plain' ? { issue: 'targetLocked' } : { binding, draft, input };
}

function checkAttachment(ctx, targetSessionId, { sessionId, verified } = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return { issue: 'sourceMissing' };
  if (sessionId === targetSessionId) return { issue: 'self' };
  const target = attachmentTarget(ctx, targetSessionId);
  if (target.issue) return target;
  const { byId } = ctx.sessions.list.getSnapshot();
  const source = Object.hasOwn(byId, sessionId) ? byId[sessionId] : undefined;
  // verified is an internal capability from an exact-ID Host lookup, never from drag/clipboard bytes.
  if (source ? source.id !== sessionId : verified !== true) return { issue: 'sourceMissing' };
  if (source?.blank) return { issue: 'sourceBlank' };
  const key = sessionKey(sessionId);
  const ids = new Set(Array.from(target.draft.draft.matchAll(/dsh-session:([A-Za-z0-9_-]+)/gu), m => m[1]));
  if (ids.has(key)) return { issue: 'duplicate' };
  if (ids.size >= 3) return { issue: 'limit' };
  return { ...target, source, key };
}

export function attachmentIssue(ctx, targetSessionId, candidate) {
  return checkAttachment(ctx, targetSessionId, candidate).issue ?? null;
}

export function insertSessionAttachment(ctx, { targetSessionId, inputActions, afterInsertFocus }, candidate, span) {
  const target = checkAttachment(ctx, targetSessionId, candidate);
  if (target.issue) return false;
  const { source, key } = target;
  const { sessionId, verified, title } = candidate;
  const label = (source?.title || source?.displayTitle || (verified && title) || sessionId).replace(/\s+/gu, ' ').trim() || sessionId;
  const ref = `@[${label.replace(/[\\\]]/gu, '\\$&')}](dsh-session:${key})`;
  const selection = span ?? inputActions?.captureInsertion();
  if (!selection) return false;
  const actx = target.binding.ctx;
  if (actx.bail(actx, 'slash/input-insert-reference', {
    reference: { source: 'reference', appearance: 'session', label, ref, clipboardText: ref },
    span: selection,
  }) !== true) return false;

  // The scoped shell's focus() restores its old Lexical selection, which can
  // be mid-draft. Set the DOM caret *after* that restoration has committed.
  const editor = target.input.editor;
  const root = editor?.getRootElement();
  if (root?.isConnected) {
    const focusEnd = () => {
      if (!root.isConnected || root !== editor.getRootElement() || ctx.sessions.binding(targetSessionId) !== target.binding) return;
      root.focus({ preventScroll: true });
      editor.focus(() => {
        if (root !== editor.getRootElement() || root.ownerDocument.activeElement !== root) return;
        const end = root.lastElementChild ?? root;
        root.ownerDocument.getSelection()?.collapse(end, end.childNodes.length);
      });
    };
    focusEnd();
    afterInsertFocus?.(focusEnd);
  }
  return true;
}

// 0.2.2-rc.5 hardcodes sectionRows. Adapt the returned candidate data, not
// the DOM: keyboard selection, aria indices and mouse picks then agree.
export function placeInAdd(rows, section) {
  if (!Array.isArray(rows) || !section) return rows;
  const at = rows.findIndex(r => r.name === 'attach-session');
  if (at < 0) return rows;
  const next = rows.slice();
  const [row] = next.splice(at, 1);
  const file = next.findIndex(r => r.name === 'file' && r.section === section);
  const first = next.findIndex(r => r.section === section);
  next.splice(file >= 0 ? file + 1 : Math.max(0, first), 0, {...row, section});
  return next;
}

export function adaptAddMenu(service, sectionLabel) {
  // Cordis gives each caller a tracked receiver. The registered source calls
  // this.candidates dynamically; wrap its defining prototype, preserve `this`.
  let owner = Object.getPrototypeOf(service);
  while (owner && !Object.hasOwn(owner,'candidates')) owner = Object.getPrototypeOf(owner);
  const desc = owner && Object.getOwnPropertyDescriptor(owner,'candidates');
  if (!desc?.writable || typeof desc.value !== 'function') return () => {};
  const original = desc.value;
  let enabled = true;
  async function candidates(session, req, ...rest) {
    const rows = await original.call(this,session,req,...rest);
    return enabled && req?.query === '' ? placeInAdd(rows,sectionLabel()) : rows;
  }
  Object.defineProperty(owner,'candidates',{...desc,value:candidates});
  return () => { enabled=false; if(owner.candidates===candidates) Object.defineProperty(owner,'candidates',desc); };
}

export function registerSessionComposer(ctx, React) {
  ctx.effect(()=>adaptAddMenu(ctx.commandUi,()=>ctx.locale.bind('command')('section.add')), 'session attachments: place after File');
  const ns = 'local.session-attachments';
  ctx.effect(() => ctx.locale.register(ns, {
    zh: {
      label: '引用会话', detail: '选择另一段对话作为上下文，发送前可移除', search: '搜索标题、工作区路径或会话 ID',
      empty: '还没有其他包含对话的会话', none: '没有匹配的会话，试试工作区名或会话 ID', unknownWorkspace: '工作区未知',
      self: '不能引用当前会话，请选择另一段对话。', sourceMissing: '找不到来源会话，请检查会话 ID。',
      sourceBlank: '来源会话还没有对话内容。', targetUnavailable: '目标会话不支持添加引用，请选择可继续对话的会话。',
      targetLocked: '当前输入框暂时不可编辑，请稍后再试。', duplicate: '草稿中已引用这个会话。',
      limit: '每条消息最多引用 3 个会话，请先移除一个。', draftChanged: '草稿已更改，请重新选择插入位置。',
    },
    en: {
      label: 'Reference a session', detail: 'Add another conversation as context. Remove it any time before sending.', search: 'Search by title, workspace path, or session ID',
      empty: 'No other sessions with a conversation yet', none: 'No matches. Try a workspace name or session ID.', unknownWorkspace: 'Unknown workspace',
      self: 'Choose another session; a session cannot reference itself.', sourceMissing: 'Source session not found. Check the session ID.',
      sourceBlank: 'The source session has no conversation yet.', targetUnavailable: 'Choose a target session that can continue the conversation.',
      targetLocked: 'The composer is not editable right now. Try again later.', duplicate: 'This draft already references that session.',
      limit: 'Each message can reference up to 3 sessions. Remove one first.', draftChanged: 'The draft changed. Choose the insertion point again.',
    },
  }), 'session attachments: menu labels');
  const t = ctx.locale.bind(ns);
  const openings = new WeakMap();
  const command = 'attach-session';
  ctx.effect(() => ctx.commandUi.register({
    name: command, label: () => t('label'), description: () => t('detail'),
    icon: ({ size = 16, className }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', className, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, React.createElement('path', { d: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-6 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' })),
    available: ({ sessionId }) => !attachmentTarget(ctx, sessionId).issue,
    ui: {
      kind: 'popupSelect',
      searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noResults: t('none') }),
      async options(session, signal) {
        const id = session.sessionId;
        const target = attachmentTarget(ctx, id);
        if (target.issue) throw new Error(t(target.issue));
        return ctx.sessions.using(id, { source: 'sessionAttachmentPicker', signal }, reference => {
          signal.throwIfAborted();
          if (reference.binding !== target.binding) throw new Error(t('targetUnavailable'));
          const actions = ctx.uiSession.bindingSource(reference).getSnapshot().props.inputActions;
          const span = actions.captureInsertion();
          const { draft, occurrences } = ctx.conversation.input.for(target.binding.ctx).state.getSnapshot();
          // Menu invocation by typing /attach… leaves the command token in the
          // editor until popup selection; replace it in the same atomic edit.
          const head = draft.slice(0, span.end).trimStart();
          const token = !occurrences.length && head.startsWith('/') && `/${command}`.startsWith(head) &&
            (draft.length === span.end || /\s/u.test(draft[span.end]));
          const saved = { binding: target.binding, span: token ? { ...span, start: draft.indexOf('/') } : span };
          const { ids, byId } = ctx.sessions.list.getSnapshot();
          const currentCwd = byId[id]?.cwd;
          const rows = ids.map(s => byId[s]).filter(row => row && row.id !== id && !row.blank);
          if (currentCwd) rows.sort((a, b) => Number(b.cwd === currentCwd) - Number(a.cwd === currentCwd));
          return rows.map(({ id: s, title, displayTitle, cwd }) => {
            // Host substring search checks label and detail, but not group headings.
            const item = { id: s, label: title || displayTitle || s, detail: cwd ? `${cwd} · ${s}` : s,
              group: { name: cwd ? `cwd:${cwd}` : 'unknown', label: cwd || t('unknownWorkspace') } };
            openings.set(item, saved);
            return item;
          });
        });
      },
      onSelect(item, { sessionId: id }) {
        const saved = openings.get(item);
        if (!saved || ctx.sessions.binding(id) !== saved.binding) throw new Error(t('targetUnavailable'));
        const candidate = { sessionId: item.id };
        if (!insertSessionAttachment(ctx, { targetSessionId: id }, candidate, saved.span)) {
          throw new Error(t(attachmentIssue(ctx, id, candidate) || 'draftChanged'));
        }
      },
    },
  }), 'session attachments: composer menu');
}
