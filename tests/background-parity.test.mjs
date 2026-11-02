import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile), cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
test('background launch returns a controllable workflow before its program finishes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'background-parity-')),script=join(root,'workflow.js'),runDir=join(root,'run');
 try {
  await writeFile(script,'export const meta={name:"background",description:"background"};await new Promise(r=>setTimeout(r,10000));return 1;');
  const {stdout}=await exec(process.execPath,[cli,'run',script,'--run-dir',runDir,'--cwd',root,'--background'],{cwd:root,timeout:5000});
  const launched=JSON.parse(stdout);assert.match(launched.runId,/^wf_/);assert.equal(launched.state,'running');
  const status=JSON.parse((await exec(process.execPath,[cli,'status','--run-dir',runDir,'--json'],{cwd:root})).stdout);
  assert.equal(status.state,'running');
 }finally{await exec(process.execPath,[cli,'cancel','--run-dir',runDir],{cwd:root}).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
