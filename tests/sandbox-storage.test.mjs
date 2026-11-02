import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
test('CLI runs without writing to a protected project .codex directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'protected-storage-')),protectedDirectory=join(root,'.codex'),script=join(root,'workflow.js');
 try {
  await mkdir(protectedDirectory);await chmod(protectedDirectory,0o500);
  await writeFile(script,'export const meta={name:"storage",description:"storage"};return 1;');
  const {stdout}=await exec(process.execPath,[cli,'run',script,'--cwd',root,'--run-dir',join(root,'run')],{cwd:root});
  assert.equal(JSON.parse(stdout).result,1);
 }finally{await chmod(protectedDirectory,0o700).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
