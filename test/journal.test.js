import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareOperation} from '../src/journal.js';

const payload={kind:'ticket',value:'Repair pump'};
async function fileFor(t){
  const dir=await mkdtemp(join(tmpdir(),'operation-journal-'));
  t.after(()=>rm(dir,{recursive:true}));
  return join(dir,'journal.json');
}
test('journal reload preserves original identity and first dispatch',async t=>{
  const file=await fileFor(t);
  const first=prepareOperation({file,intentId:'intent-1',payload,now:0});
  const restored=prepareOperation({file,intentId:'intent-1',payload,now:6});
  assert.deepEqual(restored,first);
  assert.equal(restored.firstDispatchTick,0);
  const second=prepareOperation({file,intentId:'intent-2',payload,now:6});
  assert.notEqual(second.key,first.key);
});
test('changed payload conflicts rather than silently replaying old intent',async t=>{
  const file=await fileFor(t);
  prepareOperation({file,intentId:'intent-1',payload,now:0});
  assert.throws(()=>prepareOperation({file,intentId:'intent-1',payload:{...payload,value:'Other pump'},now:1}),/intent conflict/);
});
test('corrupt or malformed journal does not reset',async t=>{
  const file=await fileFor(t);
  for(const text of ['{', '{"version":1,"operations":[{}]}']){
    await writeFile(file,text);
    assert.throws(()=>prepareOperation({file,intentId:'intent-1',payload,now:0}));
  }
});
