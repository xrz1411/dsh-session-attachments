import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentIssue, insertSessionAttachment, registerSessionComposer } from '../composer.mjs';

function fixture() {
  const id = '源/🙂\\', target = 'dest', span = { start: 2, end: 2, draftRev: 4 };
  const source = { id, displayTitle: '旧标题', title: '会话 ]\\ 🔎' };
  const data = { draft: 'hi', phase: 'plain', occurrences: [] };
  const state = { subagent: null };
  const list = { ids: [target, id, 'blank'], byId: { [id]: source, [target]: { id: target }, blank: { id: 'blank', blank: true } } };
  const observed = [], binding = { session: { getSnapshot: () => state }, ctx: { bail(self, event, arg) { assert.equal(self, binding.ctx); assert.equal(event, 'slash/input-insert-reference'); observed.push(arg); return arg.span.draftRev === span.draftRev; } } };
  const focusCalls = [], end = { childNodes: [{}, {}] };
  const doc = { activeElement: null, getSelection: () => ({ collapse: (node, offset) => focusCalls.push(['caret', node, offset]) }) };
  const root = { ownerDocument: doc, isConnected: true, lastElementChild: end, focus(options) { doc.activeElement = root; focusCalls.push(['focus', options]); } };
  const editor = { getRootElement: () => root, focus: cb => cb() };
  const actions = { captureInsertion: () => ({ ...span }) }; let command;
  const ctx = {
    sessions: { binding: t => t === target ? binding : undefined, list: { getSnapshot: () => list }, using: async (_id, _opts, fn) => fn({ binding }) },
    conversation: { input: { for: actx => { assert.equal(actx, binding.ctx); return { editor, state: { getSnapshot: () => data } }; } }, blocks: { storeFor: () => ({ getSnapshot: () => undefined }) } },
    uiSession: { bindingSource: () => ({ getSnapshot: () => ({ props: { inputActions: actions } }) }) },
    commandUi: { register: c => { command = c; return () => {}; } }, locale: { register: () => () => {}, bind: () => key => key }, effect: fn => fn(),
  };
  const add = (s = id, range) => insertSessionAttachment(ctx, { targetSessionId: target, inputActions: actions }, { sessionId: s, title: '不可信' }, range);
  return { id, target, span, data, state, list, observed, ctx, add, end, root, focusCalls, getCommand: () => command };
}

test('inserts a native reference using a trusted title and lossless Host wire ID', () => {
  const f = fixture(); assert.ok(f.add());
  const { reference, span } = f.observed[0]; assert.deepEqual(span, f.span);
  const wire = `@[会话 \\]\\\\ 🔎](dsh-session:${Buffer.from(JSON.stringify(f.id)).toString('base64url')})`;
  assert.deepEqual(reference, { source: 'reference', appearance: 'session', label: '会话 ]\\ 🔎', ref: wire, clipboardText: wire });
});

test('refuses unknown/self/blank/locked/one-shot/duplicate/over-limit references, CAS rejects stale span', () => {
  const f = fixture(); for (const id of ['__proto__', 'not-listed', 'blank', f.target]) assert.equal(f.add(id), false);
  f.data.phase = 'sending'; assert.equal(f.add(), false); f.data.phase = 'plain';
  f.state.subagent = { address: { mode: 'one-shot' } }; assert.equal(f.add(), false); f.state.subagent = null;
  f.data.draft = 'dsh-session:YQ dsh-session:Yg dsh-session:Yw'; assert.equal(f.add(), false); f.data.draft = '';
  assert.ok(f.add()); f.data.draft = f.observed.at(-1).reference.ref; assert.equal(f.add(), false);
  f.data.draft = ''; assert.equal(f.add(f.id, { ...f.span, draftRev: 0 }), false);
});

test('replaces the captured middle selection before focusing the target at the final paragraph end', () => {
  const f = fixture(), span = { ...f.span, start: 2, end: 8 };
  f.data.draft = 'a middle selection\nwith a suffix';
  let restore;
  const target = { targetSessionId: f.target, afterInsertFocus(cb) { restore = cb; } };
  assert.equal(insertSessionAttachment(f.ctx, target, { sessionId: f.id }, span), true);
  assert.deepEqual(f.observed[0].span, span);
  const expected = [['focus', { preventScroll: true }], ['caret', f.end, 2]];
  assert.deepEqual(f.focusCalls, expected);
  restore(); assert.deepEqual(f.focusCalls.splice(0), [...expected, ...expected]);
  f.root.isConnected = false; restore(); assert.deepEqual(f.focusCalls, []);
});

test('a missing source or stale selection never takes or schedules focus', () => {
  const f = fixture(), target = { targetSessionId: f.target, afterInsertFocus: () => assert.fail('scheduled focus') };
  assert.equal(insertSessionAttachment(f.ctx, target, { sessionId: 'missing' }, f.span), false);
  assert.equal(insertSessionAttachment(f.ctx, target, { sessionId: f.id }, { ...f.span, draftRev: 0 }), false);
  assert.deepEqual(f.focusCalls, []);
});

test('preflight returns a specific reason without mutating the composer', () => {
  const f = fixture(), check = (id = f.id) => attachmentIssue(f.ctx, f.target, { sessionId: id });
  assert.equal(check(), null); assert.equal(check(f.target), 'self'); assert.equal(check('blank'), 'sourceBlank');
  assert.equal(check('__proto__'), 'sourceMissing'); assert.equal(check('unknown'), 'sourceMissing');
  f.state.removed = true; assert.equal(check(), 'targetUnavailable'); f.state.removed = false;
  f.data.phase = 'sending'; assert.equal(check(), 'targetLocked'); f.data.phase = 'plain';
  f.data.draft = 'dsh-session:YQ dsh-session:Yg dsh-session:Yw'; assert.equal(check(), 'limit');
  f.data.draft += ` dsh-session:${Buffer.from(JSON.stringify(f.id)).toString('base64url')}`;
  assert.equal(check(), 'duplicate'); assert.deepEqual(f.observed, []);
});

test('picker explains rejection against the latest draft, source, and binding', async () => {
  const f = fixture(); registerSessionComposer(f.ctx, {});
  const ui = f.getCommand().ui, session = { sessionId: f.target };
  const [row] = await ui.options(session, new AbortController().signal);
  const pick = () => ui.onSelect(row, session);
  f.add(); f.data.draft = f.observed[0].reference.ref; assert.throws(pick, /^Error: duplicate$/);
  f.data.draft = ''; f.span.draftRev++; assert.throws(pick, /^Error: draftChanged$/);
  delete f.list.byId[f.id]; assert.throws(pick, /^Error: sourceMissing$/);
  f.ctx.sessions.binding = () => undefined; assert.throws(pick, /^Error: targetUnavailable$/);
});

test('picker prioritizes current workspace and makes same-title paths and IDs searchable', async () => {
  const f = fixture(), { byId, ids } = f.list, session = { sessionId: f.target };
  byId[f.target].cwd = '/here/project'; byId[f.id].cwd = '/other/project';
  byId.local = { id: 'local', title: byId[f.id].title, cwd: byId[f.target].cwd }; ids.push('local');
  registerSessionComposer(f.ctx, {});
  const rows = await f.getCommand().ui.options(session, new AbortController().signal);
  assert.deepEqual(rows.map(r => r.id), ['local', f.id]); assert.equal(rows[0].label, rows[1].label);
  assert.notEqual(rows[0].group.name, rows[1].group.name);
  for (const r of rows) { assert.ok(r.detail.includes(byId[r.id].cwd)); assert.ok(r.detail.includes(r.id)); }
});

test('exact resolver proof permits a source absent from the sidebar catalog', () => {
  const f = fixture(), target = { targetSessionId: f.target };
  assert.equal(insertSessionAttachment(f.ctx, target, { sessionId: 'old', title: 'Old' }, f.span), false);
  assert.ok(insertSessionAttachment(f.ctx, target, { sessionId: 'old', title: 'Old', verified: true }, f.span));
  assert.equal(f.observed.at(-1).reference.label, 'Old');
});

test('picker lists only nonblank other sessions and leaves unrelated text alone', async () => {
  const f = fixture(); registerSessionComposer(f.ctx, {});
  const ui = f.getCommand().ui, session = { sessionId: f.target };
  const rows = await ui.options(session, new AbortController().signal); assert.deepEqual(rows.map(r => r.id), [f.id]);
  ui.onSelect(rows[0], session); assert.deepEqual(f.observed[0].span, f.span);
});
