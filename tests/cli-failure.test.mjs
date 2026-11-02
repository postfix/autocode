import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

test('supervised CLI reports the inner workflow failure on stderr', {skip:process.platform!=='linux'}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'autocode-cli-failure-'));
  try{
    const script=join(dir,'failure.js'),runDir=join(dir,'run');
    await writeFile(script,'export const meta={name:"failure",description:"Report errors"}; throw Error("INNER_WORKFLOW_FAILURE");');
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url)),'run',script,'--cwd',dir,'--run-dir',runDir],{stdio:['ignore','pipe','pipe']});
      let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
    });
    assert.equal(result.code,1);
    assert.match(result.stderr,/autocode: INNER_WORKFLOW_FAILURE/);
    assert.match(JSON.parse(await readFile(join(runDir,'control.json'),'utf8')).error,/INNER_WORKFLOW_FAILURE/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
