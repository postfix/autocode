import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const manifest=JSON.parse(await readFile(join(root,'hooks/claude-codex-hooks.json'),'utf8'));
async function invoke(event,input,environment,chunks){
  const command=manifest.hooks[event][0].hooks[0].command;
  return new Promise((resolve,reject)=>{
    const env={...process.env,CLAUDE_PLUGIN_ROOT:root,...environment};
    if(!Object.hasOwn(environment,'PLUGIN_DATA'))delete env.PLUGIN_DATA;
    const child=spawn(command,{shell:true,env,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);
    child.on('close',code=>{if(code!==0||stderr)reject(Error(`hook exit ${code}: ${stderr}`));else resolve(stdout);});
    const parts=chunks??[Buffer.from(JSON.stringify(input))];
    (async()=>{for(const part of parts){child.stdin.write(part);await new Promise(resolve=>setTimeout(resolve,chunks?100:0));}child.stdin.end();})().catch(reject);
  });
}
for(const host of ['codex','claude'])test(`${host} packaged hook command persists standing mode through ten turns, resume and off`,async()=>{
  await mkdir(join(root,'.scratch'),{recursive:true});const dir=await mkdtemp(join(root,'.scratch/hook-integration-'));
  const env=host==='codex'?{PLUGIN_DATA:dir}:{CLAUDE_PLUGIN_DATA:dir};
  const decode=(event,text)=>host==='codex'?(JSON.parse(text).hookSpecificOutput?.additionalContext??''):text;
  const hook=async(event,payload)=>decode(event,await invoke(event,{session_id:'packaged-session',...payload},env));
  try{
    assert.equal(await hook('SessionStart',{source:'startup'}),'');
    assert.match(await hook('UserPromptSubmit',{prompt:'autocode on',prompt_id:'on'}),/Autocode is on/);
    for(let i=1;i<10;i++)assert.equal(await hook('UserPromptSubmit',{prompt:'Task '+i,prompt_id:'turn-'+i}),'');
    assert.match(await hook('UserPromptSubmit',{prompt:'Task 10',prompt_id:'turn-10'}),/still on/);
    assert.match(await hook('SessionStart',{source:'resume'}),/still on/);
    assert.match(await hook('UserPromptSubmit',{prompt:'autocode off',prompt_id:'off'}),/is off/);
    assert.equal(await hook('SessionStart',{source:'resume'}),'');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('packaged hook session identity is invariant to UTF-8 input chunk boundaries',async()=>{
  const {default:fc}=await import('fast-check');
  await fc.assert(fc.asyncProperty(fc.constantFrom('é','Ж','🙂'),async character=>{
    await mkdir(join(root,'.scratch'),{recursive:true});const dir=await mkdtemp(join(root,'.scratch/hook-utf8-'));
    try{
      const env={PLUGIN_DATA:dir},session_id='session-'+character;
      const input={session_id,prompt:'autocode on'},bytes=Buffer.from(JSON.stringify(input));
      const split=bytes.indexOf(Buffer.from(character))+1;
      await invoke('UserPromptSubmit',input,env,[bytes.subarray(0,split),bytes.subarray(split)]);
      const resumed=JSON.parse(await invoke('SessionStart',{session_id,source:'resume'},env));
      assert.match(resumed.hookSpecificOutput?.additionalContext??'',/still on/);
    }finally{await rm(dir,{recursive:true,force:true});}
  }),{numRuns:3,seed:20261102});
});
