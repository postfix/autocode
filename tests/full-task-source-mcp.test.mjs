import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('source MCP returns hashed allowlisted bytes and denies escapes and authentication files',async()=>{
 const project=await mkdtemp(join(tmpdir(),'source-mcp-'));await mkdir(join(project,'src'));await writeFile(join(project,'README.md'),'policy\n');await writeFile(join(project,'src/example.mjs'),'export const example=1;\n');await writeFile(join(project,'auth.json'),'SECRET');await symlink(join(project,'auth.json'),join(project,'src/alias.mjs'));
 const log=join(project,'reads.jsonl');const allowlist=['README.md','src/example.mjs','src/alias.mjs'];
 const client=new Client({name:'source-reader-test',version:'1.0.0'});const transport=new StdioClientTransport({command:process.execPath,args:[resolve('evals/full-task-source-mcp.mjs'),project,JSON.stringify(allowlist),log],stderr:'pipe'});
 try{
  await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools[0].annotations.readOnlyHint,true);
  const result=await client.callTool({name:'read_project_source',arguments:{file:'src/example.mjs'}});const source=JSON.parse(result.content[0].text);assert.equal(source.content,'export const example=1;\n');assert.equal(source.sha256,createHash('sha256').update(source.content).digest('hex'));
  for(const file of ['auth.json','../auth.json','/etc/passwd','src/alias.mjs']){const denied=await client.callTool({name:'read_project_source',arguments:{file}});assert.equal(denied.isError,true);assert.ok(!JSON.stringify(denied).includes('SECRET'));}
  const reads=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(reads.length,1);assert.equal(reads[0].realPath,join(project,'src/example.mjs'));assert.equal(reads[0].sha256,source.sha256);
 }finally{await client.close();await rm(project,{recursive:true,force:true});}
});
