import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile), cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
test('a detached CLI launch without parent completion delivery is rejected before startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'background-parity-')),script=join(root,'workflow.js'),runDir=join(root,'run');
 try {
  await writeFile(script,'export const meta={name:"background",description:"background"};await new Promise(r=>setTimeout(r,10000));return 1;');
  await assert.rejects(exec(process.execPath,[cli,'run',script,'--run-dir',runDir,'--cwd',root,'--background'],{cwd:root,timeout:5000}),/completion delivery/);
  await assert.rejects(access(runDir),{code:'ENOENT'},'rejected detachment must not start a hidden workflow');
 }finally{await exec(process.execPath,[cli,'cancel','--run-dir',runDir],{cwd:root}).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
