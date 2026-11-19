import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptAddMenu} from '../composer.mjs';
test('move one native candidate after File; preserve search, pick identity and restore on unload',async()=>{
 const rows=[{name:'file',section:'添加'},{name:'goal',section:'添加'},{name:'other',section:'命令'},{name:'attach-session',section:'命令'}];
 class Commands { async candidates(){assert.equal(this,service);return rows} }
 const service=new Commands(), before=service.candidates;
 const dispose=adaptAddMenu(service,()=>'添加');
 const placed=await service.candidates({}, {query:''});
 assert.deepEqual(placed.map(r=>r.name),['file','attach-session','goal','other']);assert.equal(placed[1].section,'添加');assert.equal(placed[3],rows[2]);
 assert.equal(await service.candidates({}, {query:'attach'}),rows);dispose();assert.equal(service.candidates,before);
});
