import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import fc from 'fast-check';
import {superviseRun,controlRun} from '../scripts/run-control.mjs';

async function ready(dir){for(let i=0;i<200;i++){try{if(JSON.parse(await readFile(join(dir,'control.json'),'utf8')).state==='running')return;}catch{}await delay(10);}throw Error('controller did not start');}
test('file control bounds replies and removes request artifacts even when the reply is rejected',{skip:process.platform!=='linux'},async()=>{
  await fc.assert(fc.asyncProperty(fc.integer({min:65537,max:66000}),async length=>{
    const dir=await mkdtemp(join(tmpdir(),'autocode-file-bound-'));
    const finished=superviseRun([process.execPath,'-e','setInterval(()=>{},1000)'],{runDir:dir,provider:'x'.repeat(length),forwardOutput:false,controlTransport:'file'});
    try{
      await ready(dir);
      await assert.rejects(controlRun(dir,'status'),/oversized response/);
      assert.deepEqual(await readdir(join(dir,'control-requests')),[]);
    }finally{await controlRun(dir,'cancel').catch(()=>{});await finished;await rm(dir,{recursive:true,force:true});}
  }),{numRuns:2,seed:20261102});
});

test('file controls validate bounded requests and route acknowledged skip and retry once',{skip:process.platform!=='linux'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'autocode-file-agents-'));
  const {writeFile}=await import('node:fs/promises');
  const worker="process.on('message',m=>{require('node:fs').appendFileSync(process.argv[1],m.command+'\\n');process.send({type:'agent-control-result',requestId:m.requestId});});setInterval(()=>{},1000)";
  const finished=superviseRun([process.execPath,'-e',worker,join(dir,'commands')],{runDir:dir,forwardOutput:false,controlTransport:'file'});
  try{
    await ready(dir);await delay(50);
    const descriptor=join(dir,'control.json'),owner=JSON.parse(await readFile(descriptor,'utf8'));
    await writeFile(descriptor,JSON.stringify({...owner,token:'x'.repeat(2049)}));
    try{await assert.rejects(controlRun(dir,'cancel'),/invalid file control request/);}
    finally{await writeFile(descriptor,JSON.stringify(owner));}
    assert.equal((await controlRun(dir,'status')).state,'running');
    await assert.rejects(controlRun(dir,'skip',{agent:0}),/invalid agent ID/);
    assert.equal((await controlRun(dir,'skip',{agent:1})).state,'running');
    assert.equal((await controlRun(dir,'retry',{agent:1})).state,'running');
    assert.equal(await readFile(join(dir,'commands'),'utf8'),'skip\nretry\n');
    await controlRun(dir,'pause');
    await assert.rejects(controlRun(dir,'retry',{agent:1}),/require a running workflow/);
    await controlRun(dir,'resume');
    assert.deepEqual(await readdir(join(dir,'control-requests')),[]);
    assert.equal((await controlRun(dir,'cancel')).state,'cancelled');
    assert.equal((await controlRun(dir,'cancel')).state,'cancelled');
    await finished;
    assert.deepEqual(await readdir(join(dir,'control-requests')),[]);
    assert.equal((await readdir(dir)).includes('controller.lock'),false);
  }finally{await controlRun(dir,'cancel').catch(()=>{});await finished;await rm(dir,{recursive:true,force:true});}
});

test('an unavailable file controller times out and removes its abandoned request',async()=>{
  const {writeFile,mkdir}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'autocode-file-timeout-')),commands=join(dir,'control-requests');
  try{
    await mkdir(commands,{mode:0o700});
    await writeFile(join(dir,'control.json'),JSON.stringify({state:'running',pid:process.pid,childPid:process.pid,transport:'file',commandDirectory:commands,token:'unavailable-controller'}));
    await assert.rejects(controlRun(dir,'cancel'),/workflow controller unavailable: file command timed out/);
    assert.deepEqual(await readdir(commands),[]);
    assert.doesNotThrow(()=>process.kill(process.pid,0));
  }finally{await rm(dir,{recursive:true,force:true});}
});
