import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAttachment } from '../preview.mjs';
const item=id=>({source:'reference',appearance:'session',label:'同名',ref:`@[同名](dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')})`});
test('preview resolves exact IDs, not colliding labels; tolerates missing metadata',()=>{
 const byId={other:{title:'同名',cwd:'/other'},'中文':{title:'完整标题',cwd:'/target'}};
 assert.deepEqual(describeAttachment(item('中文'),byId),{id:'中文',title:'完整标题',cwd:'/target'});
 assert.deepEqual(describeAttachment(item('absent'),byId),{id:'absent',title:'同名',cwd:''});
});
test('file chips, malformed references and unrelated sources have no session preview',()=>{
 for(const changes of [{appearance:'file'},{ref:'dsh-session:b2hvbw'},{source:'other'}])assert.equal(describeAttachment({...item('ok'),...changes},{}),null);
});
