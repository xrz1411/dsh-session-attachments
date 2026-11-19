// The native popup owns both the sidebar row's context gesture and its … button.
// A main-view reference alone is insufficient: another panel or composer takeover
// can hide its still-resident draft. Only a mounted, editable main composer qualifies.
export function installRowMenu({ctx, React, attachmentIssue, insertSessionAttachment}) {
  const ns = 'session-attachments-row-menu';
  ctx.effect(() => ctx.locale.register(ns, {
    zh: {add:'添加到当前聊天', added:'已将会话添加到当前聊天的草稿。', changed:'当前聊天已改变，请重新打开会话菜单。'},
    en: {add:'Add to current chat', added:'Session added to the current chat draft.', changed:'The active chat changed. Open the session menu again.'},
  }), 'session attachments: row menu labels');
  const t = ctx.locale.bind(ns);
  const reason = ctx.locale.bind('local.session-attachments');
  const mounted = new Set();
  function ComposerAnchor({sessionId, inputActions}) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => {
      const card = ref.current?.closest('[data-composer-card]');
      const region = card?.closest('[data-conversation-content]');
      if (!inputActions || region?.getAttribute('data-conversation-session') !== sessionId) return;
      const hit = {sessionId, inputActions, card};
      mounted.add(hit);
      return () => mounted.delete(hit);
    }, [sessionId, inputActions]);
    return React.createElement('span', {ref, hidden:true});
  }
  const slot = 'conversation.input.overlay';
  ctx.slots.inject(slot, () => ctx.slots.register({name:slot, id:'session-attachments-row-target'}, ComposerAnchor));
  const current = () => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) return;
    const {props} = ctx.uiSession.adapter.current.getSnapshot();
    if (!props.sessionId) return;
    const matches = [...mounted].filter(m => m.sessionId === props.sessionId && m.inputActions === props.inputActions && m.card.isConnected);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const iconKey = 'local.session-attachments.add-to-chat';
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({name:'contextMenu.icon', key:iconKey}, () =>
    React.createElement('svg', {width:16, height:16, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.7, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true},
      React.createElement('path', {d:'M20.5 14.5a3 3 0 0 1-3 3H10l-5.5 4v-4a3 3 0 0 1-2-2.8V6.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z M8 10.5h7 M11.5 7v7'}))));
  const menus = ctx.contextMenus;
  ctx.effect(() => menus.register({
    id:'local.session-attachments.row', target:'session', order:400,
    resolve({sessionId}) {
      const source = {sessionId};
      const opened = current();
      return [{id:'add-to-current-chat', label:t('add'), icon:{key:iconKey}, failureLabel:reason('draftChanged'), run() {
        if (!opened) return menus.notify(reason('targetUnavailable'), false);
        if (current() !== opened) return menus.notify(t('changed'), false);
        const {sessionId:targetSessionId, inputActions, card} = opened;
        const check = () => {
          const issue = attachmentIssue(ctx, targetSessionId, source);
          if (issue) return issue;
          const editor = card.querySelector('[data-composer-input][contenteditable="true"]:not([data-composer-composing])');
          return !editor || editor.closest('[inert],[hidden],[aria-hidden="true"]') ||
            editor.checkVisibility?.({visibilityProperty:true, opacityProperty:true}) === false ? 'targetLocked' : null;
        };
        const issue = check();
        if (issue) return menus.notify(reason(issue), false);
        const doc = card.ownerDocument;
        const popup = doc?.activeElement?.closest('[role="menu"]') || doc?.querySelector('[data-context-menu][role="menu"], [data-context-menu] [role="menu"]');
        const afterInsertFocus = focus => {
          const win = doc?.defaultView;
          if (!win || !popup?.isConnected) return;
          // After the native exit transition the menu may restore its opener.
          // Yield to any deliberate interaction during that transition.
          const guard = new AbortController();
          const stop = () => guard.abort();
          const observer = new win.MutationObserver(() => {
            if (popup.isConnected) return;
            observer.disconnect();
            win.requestAnimationFrame(() => {
              if (!guard.signal.aborted && current() === opened && !menus.active?.getSnapshot()) focus();
              stop();
            });
          });
          observer.observe(doc.body, {childList:true, subtree:true});
          for (const event of ['pointerdown','keydown','beforeinput']) doc.addEventListener(event,stop,{capture:true,signal:guard.signal});
          const timeout = win.setTimeout(stop, 1500);
          guard.signal.addEventListener('abort', () => {observer.disconnect(); win.clearTimeout(timeout);}, {once:true});
        };
        if (!insertSessionAttachment(ctx, {targetSessionId, inputActions, afterInsertFocus}, source)) return menus.notify(reason(check() || 'draftChanged'), false);
        menus.notify(t('added'), true);
      }}];
    },
  }), 'session attachments: native row menu');
}
