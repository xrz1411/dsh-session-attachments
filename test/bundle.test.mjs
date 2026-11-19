import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the built browser factory loads without host code and declares native menu dependencies',async()=>{
  const js=await readFile(new URL('../client.js',import.meta.url),'utf8');
  let bundle;
  runInNewContext(js,{window:{__ModuleLoader__:{load(b){bundle=b}}}});
  assert.equal(bundle.id,'@local/session-attachments');
  const plugin=bundle.factory(id=>{assert.equal(id,'react');return {}});
  assert.equal(typeof plugin.apply,'function');
  for(const key of ['slots','contextMenus','layout','conversation'])assert.ok(plugin.inject.includes(key),key);
});
