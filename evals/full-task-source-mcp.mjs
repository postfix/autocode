import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {readFile,realpath,stat,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [projectArgument,allowlistArgument,receiptFile]=process.argv.slice(2);
const project=await realpath(projectArgument);
const names=JSON.parse(allowlistArgument);
if(!Array.isArray(names)||names.length>256||names.some(file=>typeof file!=='string'||!(file==='README.md'||file.startsWith('src/')&&file.endsWith('.mjs'))||file.split('/').some(part=>!part||part==='.'||part==='..')))throw Error('Invalid source allowlist');
if(typeof receiptFile!=='string'||resolve(receiptFile)!==receiptFile)throw Error('An absolute source receipt path is required');
const allowed=new Set(names);
const server=new Server({name:'autocode-evaluation-source-reader',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'read_project_source',description:'Read original README.md or an allowlisted src/*.mjs source file. Returns exact UTF-8 bytes and SHA256. No authentication, evaluator, or other files are accessible.',inputSchema:{type:'object',properties:{file:{type:'string',enum:names}},required:['file'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async request=>{
 try{
  const file=request.params.arguments?.file;
  if(request.params.name!=='read_project_source'||typeof file!=='string'||!allowed.has(file))throw Error('Source access denied');
  const path=join(project,file),actual=await realpath(path);
  if(actual!==path)throw Error('Source access denied');
  const metadata=await stat(actual);if(!metadata.isFile()||metadata.size>128*1024)throw Error('Source access denied');
  const content=await readFile(actual,'utf8'),sha256=createHash('sha256').update(content).digest('hex');
  await appendFile(receiptFile,JSON.stringify({time:new Date().toISOString(),pid:process.pid,file,realPath:actual,sha256,bytes:Buffer.byteLength(content)})+'\n',{mode:0o600});
  return {content:[{type:'text',text:JSON.stringify({file,sha256,content})}]};
 }catch{return {isError:true,content:[{type:'text',text:'Source access denied or unavailable'}]};}
});
await server.connect(new StdioServerTransport());
