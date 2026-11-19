// Read metadata only. Never expand a referenced conversation in the browser.
export function describeAttachment(item, byId) {
  if (item?.appearance !== 'session' || item.source !== 'reference') return null;
  const m = /(?:^|\()(dsh-session:([\w-]+))\)?$/u.exec(item.ref || '');
  if (!m) return null;
  try {
    const id = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(m[2].replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0))));
    if (typeof id !== 'string' || !id) return null;
    const row = Object.hasOwn(byId,id) ? byId[id] : undefined;
    return {id, title:row?.title || row?.displayTitle || item.label || id, cwd:row?.cwd || ''};
  } catch { return null; }
}

export function installAttachmentPreview(ctx, React) {
  const ns='session-attachment-preview';
  ctx.effect(()=>ctx.locale.register(ns,{
    zh:{review:'核对会话附件',work:'来源工作区',unknown:'工作区未知',note:'发送时附上对话文本快照，不同步后续更新。'},
    en:{review:'Review attached sessions',work:'Source workspace',unknown:'Unknown workspace',note:'Sending includes a text snapshot, not future updates.'},
  }));
  const t=ctx.locale.bind(ns), h=React.createElement;
  function Preview({useInput,useSessions}) {
    const occurrences=useInput(s=>s.occurrences), byId=useSessions(s=>s.byId);
    const anchor=React.useRef(null), [hover,setHover]=React.useState(null), [expanded,setExpanded]=React.useState(false);
    const items=occurrences.filter(o=>o.source==='reference');
    const refs=items.map(o=>describeAttachment(o,byId));
    const any=refs.some(Boolean);
    React.useEffect(()=>{
      setHover(null); if(!any) setExpanded(false);
      const card=anchor.current?.closest('[data-conversation-content]')?.querySelector('[data-composer-card]'); if(!card || !any) return;
      const editor=card.querySelector('[data-composer-input]'); if(!editor) return;
      const selector='[data-composer-chip="reference"]';
      const pick=e=>{
        const chip=e.target?.closest?.(selector);
        const nodes=editor.querySelectorAll(selector);
        const i=chip && nodes.length===items.length ? Array.prototype.indexOf.call(nodes,chip) : -1;
        setHover(i>=0 && chip.textContent===items[i].label ? items[i].occurrenceId : null);
      };
      const leave=e=>{if(!e.target?.closest?.(selector)?.contains(e.relatedTarget))setHover(null)};
      const esc=e=>{if(e.key==='Escape'){setHover(null);setExpanded(false)}};
      for(const [name,fn] of [['pointerover',pick],['pointerout',leave],['focusin',pick],['focusout',leave]])editor.addEventListener(name,fn);
      card.addEventListener('keydown',esc);
      return ()=>{for(const [name,fn] of [['pointerover',pick],['pointerout',leave],['focusin',pick],['focusout',leave]])editor.removeEventListener(name,fn);card.removeEventListener('keydown',esc)};
    },[occurrences,any]);
    if(!any)return null;
    const active=refs[items.findIndex(o=>o.occurrenceId===hover)];
    const shown=expanded?refs.filter(Boolean):active?[active]:[];
    return h('div',{ref:anchor,style:{position:'relative',fontSize:12,color:'var(--dsw-alias-label-secondary)'}},
      h('button',{type:'button','aria-expanded':expanded,onClick:()=>setExpanded(v=>!v),onKeyDown:e=>{if(e.key==='Escape')setExpanded(false)},style:{font:'inherit',color:'inherit',background:'transparent',border:0,cursor:'pointer',padding:'2px 6px'}},t('review')),
      shown.length>0 && h('div',{role:expanded?'note':'tooltip',style:{position:expanded?'relative':'absolute',bottom:expanded?undefined:'100%',zIndex:3,width:'max-content',maxWidth:'min(34rem,80vw)',boxSizing:'border-box',padding:'8px 12px',borderRadius:8,overflowWrap:'anywhere',background:'var(--dsw-alias-button-elevated-fill)',border:'1px solid var(--dsw-alias-border-l4)',pointerEvents:expanded?'auto':'none'}},
        ...shown.map((r,i)=>h('div',{key:i},h('strong',null,r.title),h('div',null,`${t('work')}：${r.cwd||t('unknown')}`),h('small',null,r.id))),h('div',{style:{marginTop:4}},t('note'))));
  }
  ctx.slots.inject('conversation.composer.dock',()=>ctx.slots.register({name:'conversation.composer.dock',id:'session-attachment-preview',order:55},Preview));
}
