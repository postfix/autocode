import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,open,link,rename,chmod,unlink,rmdir,realpath,readdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {safeText,readRunStatus} from './run-stats.mjs';

const terminal=new Set(['completed','failed','cancelled']);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function processInfo(pid){try{const text=await readFile(`/proc/${pid}/stat`,'utf8'),parts=text.slice(text.lastIndexOf(')')+2).split(' ');return {pid:Number(pid),state:parts[0],start:parts[19]};}catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}}
async function tree(pid){const record=await processInfo(pid);if(!record)return [];let children='';try{children=await readFile(`/proc/${pid}/task/${pid}/children`,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}return [record,...(await Promise.all(children.trim().split(/\s+/).filter(Boolean).map(tree))).flat()];}
async function signalProcess(identity,signal){const current=await processInfo(identity.pid);if(current?.start!==identity.start)return;try{process.kill(identity.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}}
async function persist(file,state,{exclusive=false}={}){
  const temp=file+'.'+randomUUID();let handle;
  try{
    handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(state)+'\n');}finally{await handle.close();}
    if(exclusive)await link(temp,file);else await rename(temp,file);
  }finally{if(handle)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export async function controlRun(directory,command,{agent}={}){
  if(!['status','pause','resume','cancel','skip','retry'].includes(command))throw Error('unknown workflow control');
  const state=JSON.parse(await readFile(join(resolve(directory),'control.json'),'utf8').catch(async error=>{
    if(error.code!=='ENOENT')throw error;
    await readFile(join(resolve(directory),'runner.json'),'utf8');
    throw Error('This embedded workflow is controlled by its host; CLI process controls require autocode run');
  }));
  if(terminal.has(state.state)){if(command==='status'||command==='cancel'&&state.state==='cancelled')return publicState(state);throw Error(`workflow is already ${state.state}`);}
  if (state.transport === 'file') {
    const id = randomUUID(), request = join(state.commandDirectory, `request-${id}.json`), reply = join(state.commandDirectory, `reply-${id}.json`);
    const temporary = request + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify({token:state.token,command,agent}), {mode:0o600,flag:'wx'});
      await rename(temporary, request);
      for (let attempt=0;attempt<1000;attempt++) {
        const answer = await (async()=>{
          const info=await lstat(reply);
          if(!info.isFile()||info.size>65536)throw Error('workflow controller unavailable: oversized response');
          const answer=await readFile(reply,'utf8');
          if(Buffer.byteLength(answer)>65536)throw Error('workflow controller unavailable: oversized response');
          return answer;
        })().catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if (answer !== null) { const result=JSON.parse(answer);if(result.error)throw Error(result.error);return result; }
        await delay(10);
      }
      throw Error('workflow controller unavailable: file command timed out');
    } finally { for (const path of [temporary,request,reply]) await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
  }
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(state.endpoint);let text='';
    const fail=error=>{socket.destroy();reject(Error(`workflow controller unavailable: ${error.message}`));};
    socket.setTimeout(10000,()=>fail(Error('timed out')));
    socket.on('error',fail);socket.on('connect',()=>socket.write(JSON.stringify({token:state.token,command,agent})+'\n'));
    socket.on('data',chunk=>{text+=chunk;if(text.length>65536)return fail(Error('oversized response'));if(text.includes('\n')){socket.end();try{const reply=JSON.parse(text.split('\n')[0]);if(reply.error)reject(Error(reply.error));else resolve(reply);}catch(error){fail(error);}}});
    socket.on('end',()=>{if(!text.includes('\n'))fail(Error('incomplete response'));});
  });
}
function publicState({token,endpoint,commandDirectory,...state}){return state;}

export async function superviseRun(command,{runDir,runId,project,provider,forwardOutput=true,controlTransport='auto'}){
  if(!['auto','file'].includes(controlTransport))throw Error('unknown workflow control transport');
  // shortcut: Linux /proc supplies process-tree identity; add a backend before enabling other hosts.
  if(process.platform!=='linux')throw Error('live workflow pause/resume/cancel currently require Linux');
  runDir=resolve(runDir);await mkdir(runDir,{recursive:true});
  if(project){project=await realpath(project);if(!/^wf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId??''))throw Error('invalid project workflow ID');}
  if(runId)for(const name of ['run.json','control.json']){
    const saved=await readFile(join(runDir,name),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
    if(saved.runId&&saved.runId!==runId)throw Error(`run directory already belongs to workflow ${safeText(saved.runId)}; use its recorded ID with --resume or start in a new directory`);
  }
  const embedded=await readFile(join(runDir,'runner.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(embedded){
    const prior=await readRunStatus(runDir);
    if(prior.controllable===false&&prior.state==='running')throw Error('Embedded workflow is still running; resume only after it ends');
  }
  const lock=join(runDir,'controller.lock');
  await mkdir(lock).catch(error=>{if(error.code==='EEXIST')throw Error('this run already has a controller; inspect it before restarting');throw error;});
  try{return await startRun(command,{runDir,runId,project,provider,forwardOutput,controlTransport});}finally{await rmdir(lock);}
}

async function startRun(command,{runDir,runId,project,provider,forwardOutput,controlTransport}){
  const file=join(runDir,'control.json');
  try{const previous=JSON.parse(await readFile(file,'utf8'));if(!terminal.has(previous.state))throw Error('this run already has a controller; inspect it before restarting');}catch(error){if(error.code!=='ENOENT')throw error;}
  const state={version:1,runDir,runId,project,state:'starting',pid:process.pid,childPid:null,provider,startedAt:Date.now(),token:randomUUID(),endpoint:`/tmp/autocode-${process.getuid()}-${randomUUID()}.sock`};
  // The socket is tiny; workflow journals and build artifacts remain in runDir on disk.
  await persist(file,state,{exclusive:true}).catch(async error=>{if(error.code!=='EEXIST')throw error;const old=JSON.parse(await readFile(file,'utf8'));if(!terminal.has(old.state))throw Error('this run already has a controller');await persist(file,state);});
  let child,completion,stderr='',stopped=[],cancelledMembers=[],cancellationError=null,queue=Promise.resolve(),writes=Promise.resolve();
  const save=()=>{const snapshot=structuredClone(state);writes=writes.then(()=>persist(file,snapshot)).catch(error=>{state.persistenceError=safeText(error.message);});return writes;};
  const dispatch = async request => {
          const token=Buffer.from(String(request.token??'')),expected=Buffer.from(state.token);
          if(token.length!==expected.length||!timingSafeEqual(token,expected))throw Error('invalid workflow control token');
          if(!['status','pause','resume','cancel','skip','retry'].includes(request.command))throw Error('unknown workflow control');
          if(request.command!=='status'){
            if(!child||terminal.has(state.state))throw Error(`workflow is ${state.state}`);
            if (['skip','retry'].includes(request.command)) {
              if (state.state !== 'running') throw Error('agent controls require a running workflow');
              if (!Number.isSafeInteger(request.agent) || request.agent < 1) throw Error('invalid agent ID');
              const requestId=randomUUID();
              await new Promise((resolve,reject)=>{
                const cleanup=()=>{clearTimeout(timer);child.removeListener('message',listener);};
                const listener=message=>{if(message?.type==='agent-control-result'&&message.requestId===requestId){cleanup();if(message.error)reject(Error(message.error));else resolve();}};
                const timer=setTimeout(()=>{cleanup();reject(Error('agent control was not acknowledged'));},5000);
                child.on('message',listener);
                child.send({type:'agent-control',requestId,agent:request.agent,command:request.command},error=>{if(error){cleanup();reject(error);}});
              });
            }else if(request.command==='pause'&&state.state==='running'){
              try{
                stopped=await tree(child.pid);
                process.kill(-child.pid,'SIGSTOP');
                for(let round=0;round<50;round++){
                  const observed=await tree(child.pid),known=new Map(stopped.map(item=>[`${item.pid}:${item.start}`,item]));
                  for(const item of observed)known.set(`${item.pid}:${item.start}`,item);
                  stopped=[...known.values()];
                  for(const item of observed)if(!['T','t','Z'].includes(item.state))await signalProcess(item,'SIGSTOP');
                  if((await tree(child.pid)).every(item=>['T','t','Z'].includes(item.state)))break;
                  if(round===49)throw Error('could not confirm all workflow processes are paused');
                  await delay(10);
                }
                if(terminal.has(state.state)||child.exitCode!==null||child.signalCode!==null)throw Error('workflow ended while pausing');
                state.state='paused';await save();
              }catch(error){
                let resumed=true;
                for(const item of stopped)await signalProcess(item,'SIGCONT').catch(()=>{resumed=false;});
                if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGCONT');}catch{resumed=false;}state.state=resumed?'running':'unavailable';}
                state.controlError=safeText(`Pause was not confirmed: ${error.message}`);await save();throw error;
              }
            }else if(request.command==='resume'&&state.state==='paused'){
              for(const item of stopped)await signalProcess(item,'SIGCONT');process.kill(-child.pid,'SIGCONT');stopped=[];state.state='running';await save();
            }else if(request.command==='cancel'){
              state.state='cancelling';await save();
              let members=[];
              try{members=await tree(child.pid);}catch(error){cancellationError=safeText(error.message);}
              cancelledMembers=[...members,...stopped];
              for(const item of cancelledMembers.toReversed())if(item.pid!==child.pid)await signalProcess(item,'SIGKILL');
              if(child.exitCode===null&&child.signalCode===null)process.kill(-child.pid,'SIGKILL');
              await completion;
              if(state.state!=='cancelled')throw Error(state.error??'cancellation was not confirmed');
            }else if(request.command==='pause'&&state.state!=='paused'||request.command==='resume'&&state.state!=='running')throw Error(`cannot ${request.command} a ${state.state} workflow`);
          }
    return publicState(state);
  };
  let controlPoller, polling = false, socketCreated = false;
  const server=net.createServer(socket=>{
    let input='';socket.setTimeout(10000,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      input+=chunk;if(input.length>2048){socket.destroy();return;}
      if(!input.includes('\n'))return;
      socket.removeAllListeners('data');
      queue=queue.then(async()=>{
        try{
          socket.end(JSON.stringify(await dispatch(JSON.parse(input.split('\n')[0])))+'\n');
        }catch(error){socket.end(JSON.stringify({error:safeText(error.message)})+'\n');}
      }).catch(()=>socket.destroy());
    });
  });
  const onSignal=()=>{controlRun(runDir,'cancel').catch(()=>{});};
  try{
    if(project){
      const root=join(project,'.autocode/runs');await mkdir(root,{recursive:true});
      const ref=join(root,runId+'.json'),registration={project,runDir:await realpath(runDir)};
      await persist(ref,registration,{exclusive:true}).catch(async error=>{
        if(error.code!=='EEXIST')throw error;
        const previous=JSON.parse(await readFile(ref,'utf8'));
        if(previous.project!==project||previous.runDir!==registration.runDir)throw Error('workflow ID already registered to another run');
        await persist(ref,registration);
      });
    }
    try {
      if(controlTransport==='file')throw Object.assign(Error('file control requested'),{code:'EPERM'});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(state.endpoint,resolve);});socketCreated=true;await chmod(state.endpoint,0o600);
    } catch(error) {
      if (!['EPERM','EACCES'].includes(error.code)) throw error;
      state.transport='file';state.commandDirectory=join(runDir,'control-requests');
      await mkdir(state.commandDirectory,{recursive:true,mode:0o700});
      controlPoller=setInterval(()=>{
        if(polling)return;polling=true;
        queue=queue.then(async()=>{
          for(const name of await readdir(state.commandDirectory)) {
            if(!/^request-[0-9a-f-]{36}\.json$/.test(name))continue;
            const request=join(state.commandDirectory,name),reply=join(state.commandDirectory,name.replace(/^request-/,'reply-'));
            let response;
            try {
              const info=await lstat(request);
              if(!info.isFile()||info.size>2048)throw Error('invalid file control request');
              response=await dispatch(JSON.parse(await readFile(request,'utf8')));
            }catch(error){response={error:safeText(error.message)};}
            await persist(reply,response);
            await unlink(request).catch(error=>{if(error.code!=='ENOENT')throw error;});
          }
        }).catch(error=>{state.controlError=safeText(error.message);}).finally(()=>{polling=false;});
      },10);
      await save();
    }
    child=spawn(command[0],command.slice(1),{detached:true,env:{...process.env,AUTOCODE_WORKER:'1',AUTOCODE_RUN_ID:runId??''},stdio:['ignore',forwardOutput?'inherit':'ignore','pipe','ipc']});
    state.childPid=child.pid;state.state='running';
    completion=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',async(code,signal)=>{
        try{
          state.exitCode=code;state.signal=signal;state.endedAt=Date.now();
          if(state.state==='cancelling'){
            for(let round=0;round<100;round++){
              const live=await Promise.all(cancelledMembers.map(async identity=>{const current=await processInfo(identity.pid);return current?.start===identity.start&&current.state!=='Z';}));
              if(!live.some(Boolean)){state.state=cancellationError?'unavailable':'cancelled';if(cancellationError)state.error=`Process-tree cancellation could not be fully verified: ${cancellationError}`;break;}
              if(round===99){state.state='unavailable';state.error='Cancellation could not confirm every recorded process stopped';}
              else await delay(10);
            }
          }else state.state=code===0?'completed':'failed';
          if(state.state==='failed')state.error=safeText(stderr||`program exited with ${signal??code}`);
          await save();resolve(publicState(state));
        }catch(error){reject(error);}
      });
    });
    completion.catch(()=>{});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);if(forwardOutput)process.stderr.write(chunk);});
    process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
    if(forwardOutput)process.stderr.write(`Autocode workflow: ${runId??runDir}\n`);
    await save();
    return await completion;
  }catch(error){
    if(child?.pid&&child.exitCode===null&&child.signalCode===null){
      let members=stopped;
      try{members=[...members,...await tree(child.pid)];}catch{}
      for(const item of members.toReversed())if(item.pid!==child.pid)await signalProcess(item,'SIGKILL').catch(()=>{});
      try{process.kill(-child.pid,'SIGKILL');}catch(failure){if(failure.code!=='ESRCH')throw failure;}
      await completion?.catch(()=>{});
    }
    state.state='failed';state.error=safeText(error.message);state.endedAt=Date.now();await save();throw error;
  }finally{
    clearInterval(controlPoller);await queue.catch(()=>{});
    process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
    await new Promise(resolve=>server.close(resolve));if(socketCreated)await unlink(state.endpoint).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(state.persistenceError&&forwardOutput)process.stderr.write(`Autocode control state could not be saved: ${state.persistenceError}\n`);
  }
}
