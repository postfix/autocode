import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
test('structured results must satisfy the requested schema before returning to the workflow',async()=>{
 const query=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{answer:'wrong'},usage:{output_tokens:1}};})();
 await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),query}),/schema validation/);
});

test('Codex preserves an omitted optional property through its strict transport schema',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 class FakeCodex {startThread(){return {run:async()=>({finalResponse:'{"answer":42,"note":{"present":false,"value":null}}',usage:{output_tokens:1}})};}}
 const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer'},note:{type:'string'}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{answer:42});
});

test('Claude repairs a schema-invalid result before returning it to the workflow',async()=>{
 let first=true;
 const query=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{answer:first?'wrong':42},usage:{output_tokens:1}};first=false;})();
 const output=await claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),query});
 assert.deepEqual(output.result,{answer:42});
 assert.equal(output.outputTokens,2);
});

test('Codex repairs a schema-invalid result and includes repair tokens',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 let first=true;
 class FakeCodex {startThread(){return {run:async()=>{const finalResponse=first?'not JSON':'{"answer":42}';first=false;return {finalResponse,usage:{output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{answer:42});assert.equal(output.outputTokens,2);
});

test('an impossible closed object schema is rejected before starting a provider',async()=>{
 const query=()=>{throw Error('provider must not start');};
 await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{},required:['missing'],additionalProperties:false}},{runDir:process.cwd(),query}),/unsatisfiable/);
});

test('Codex validates composed objects through JSON text when native transport cannot preserve them',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 for(const keyword of ['anyOf','oneOf','allOf']) {
  class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);return {finalResponse:'{"answer":{}}',usage:{output_tokens:1}};}};}}
  const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'object',[keyword]:[{type:'object',properties:{note:{type:'string'}}}]}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
  assert.deepEqual(output.result,{answer:{}});
 }
});

test('schema preflight permits required properties accepted by patternProperties',async()=>{
 const query=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{answer:42},usage:{output_tokens:1}};})();
 const output=await claudeAgent('answer',{schema:{type:'object',properties:{},patternProperties:{'^answer$':{type:'integer'}},required:['answer'],additionalProperties:false}},{runDir:process.cwd(),query});
 assert.deepEqual(output.result,{answer:42});
});

test('Codex preserves boolean subschemas through validated JSON text',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);return {finalResponse:'{}',usage:{output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:false},required:[]}},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{});
});

test('Codex preserves object type unions through validated JSON text',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);return {finalResponse:'{"answer":null}',usage:{output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:['object','null'],properties:{note:{type:'string'}}}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{answer:null});
});

test('schema preflight rejects crossed bounds on required values without rejecting optional impossible values',async()=>{
 let started=false;
 const query=()=>{started=true;throw Error('provider must not start');};
 await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'number',minimum:2,maximum:1}},required:['answer']}},{runDir:process.cwd(),query}),/unsatisfiable.*bounds/);
 assert.equal(started,false);
 const validQuery=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{},usage:{output_tokens:1}};})();
 const output=await claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'number',minimum:2,maximum:1}},required:[]}},{runDir:process.cwd(),query:validQuery});
 assert.deepEqual(output.result,{});
});

test('Codex preserves boolean and tuple array items through validated JSON text',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 for(const [items,answer] of [[false,[]],[[{type:'integer'}],[42]]]) {
  class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);return {finalResponse:JSON.stringify({answer}),usage:{output_tokens:1}};}};}}
  const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'array',items}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
  assert.deepEqual(output.result,{answer});
 }
});

test('Codex preserves optional primitive union values through strict transport',async()=>{
 const {default:fc}=await import('fast-check');
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 await fc.assert(fc.asyncProperty(fc.option(fc.oneof(fc.integer(),fc.string()),{nil:undefined}),async value=>{
  class FakeCodex {startThread(){return {run:async()=>({finalResponse:JSON.stringify({answer:{present:value!==undefined,value:value??null}}),usage:{output_tokens:1}})};}}
  const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{anyOf:[{type:'integer'},{type:'string'}]}},required:[]}},{runDir:process.cwd(),Codex:FakeCodex});
  assert.deepEqual(output.result,value===undefined?{}:{answer:value});
 }),{numRuns:50});
});

test('Codex decodes tagged object union branches and preserves optional nested fields',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 for(const keyword of ['anyOf','oneOf']) {
  class FakeCodex {startThread(){return {run:async()=>({finalResponse:JSON.stringify({answer:{branch:1,value:{kind:'text',note:{present:false,value:null}}}}),usage:{output_tokens:1}})};}}
  const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{[keyword]:[{type:'integer'},{type:'object',properties:{kind:{const:'text',type:'string'},note:{type:'string'}},required:['kind'],additionalProperties:false}]}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
  assert.deepEqual(output.result,{answer:{kind:'text'}});
 }
});

test('Codex tagged unions preserve generated optional fields behind local references',async()=>{
 const {default:fc}=await import('fast-check');
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 await fc.assert(fc.asyncProperty(fc.option(fc.string(),{nil:undefined}),async note=>{
  class FakeCodex {startThread(){return {run:async()=>({finalResponse:JSON.stringify({answer:{branch:1,value:{note:{present:note!==undefined,value:note??null}}}}),usage:{output_tokens:1}})};}}
  const output=await codexAgent('answer',{schema:{type:'object',$defs:{record:{type:'object',properties:{note:{type:'string'}},additionalProperties:false}},properties:{answer:{oneOf:[{type:'integer'},{$ref:'#/$defs/record'}]}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
  assert.deepEqual(output.result,{answer:note===undefined?{}:{note}});
 }),{numRuns:50});
});

test('Codex tagged oneOf unions still reject outputs matching multiple original branches',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 class FakeCodex {startThread(){return {run:async()=>({finalResponse:JSON.stringify({answer:{branch:0,value:{note:{present:false,value:null}}}}),usage:{output_tokens:1}})};}}
 await assert.rejects(codexAgent('answer',{schema:{type:'object',properties:{answer:{oneOf:[{type:'object',properties:{note:{type:'string'}}},{type:'object',properties:{other:{type:'integer'}}}]}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex}),/schema validation.*oneOf/);
});

test('schema preflight rejects crossed required string bounds',async()=>{
 const {default:fc}=await import('fast-check');
 await fc.assert(fc.asyncProperty(fc.integer({min:0,max:100}),async maximum=>{
  await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'string',minLength:maximum+1,maxLength:maximum}},required:['answer']}},{runDir:process.cwd(),query:()=>{throw Error('provider must not start');}}),/unsatisfiable.*bounds/);
 }),{seed:2601102,numRuns:30});
});

test('schema preflight rejects crossed required array bounds',async()=>{
 const {default:fc}=await import('fast-check');
 await fc.assert(fc.asyncProperty(fc.integer({min:0,max:100}),async maximum=>{
  await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'array',minItems:maximum+1,maxItems:maximum}},required:['answer']}},{runDir:process.cwd(),query:()=>{throw Error('provider must not start');}}),/unsatisfiable.*bounds/);
 }),{seed:2601102,numRuns:30});
});

test('schema preflight rejects required integer intervals containing no integer',async()=>{
 const {default:fc}=await import('fast-check');
 await fc.assert(fc.asyncProperty(fc.integer({min:-100,max:100}),async lower=>{
  await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer',exclusiveMinimum:lower,exclusiveMaximum:lower+1}},required:['answer']}},{runDir:process.cwd(),query:()=>{throw Error('provider must not start');}}),/unsatisfiable.*integer/);
 }),{seed:2601102,numRuns:30});
});

test('Codex schema repairs accumulate input and cached input usage across turns',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 let calls=0,lastUsage;
 class FakeCodex {startThread(){return {run:async()=>{calls++;return {finalResponse:calls===1?'invalid JSON':'{"answer":42}',usage:{input_tokens:calls*10,cached_input_tokens:calls*2,output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex,onUsage:usage=>{lastUsage=usage;}});
 assert.deepEqual(lastUsage,{outputTokens:2,inputTokens:30,cachedInputTokens:6});
 assert.equal(output.outputTokens,2);
});

test('Codex uses validated JSON text fallback for object intersections and repairs invalid output',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 const schema={type:'object',properties:{answer:{allOf:[{type:'object',properties:{a:{type:'integer'}},required:['a']},{type:'object',properties:{b:{type:'integer'}},required:['b']}]}},required:['answer']};
 let calls=0,instructions;
 class FakeCodex {constructor(options){instructions=options.config.developer_instructions;}startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);calls++;return {finalResponse:JSON.stringify({answer:{a:calls===1?'wrong':1,b:2}}),usage:{output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{answer:{a:1,b:2}});assert.equal(calls,2);assert.equal(output.outputTokens,2);
 assert.ok(instructions.includes(JSON.stringify(schema)));
});

test('Codex uses original JSON semantics for unsupported native assertion keywords',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 const schema={type:'object',properties:{answer:{type:'object',properties:{note:{type:'string'}},not:{properties:{note:{const:'blocked'}},required:['note']},if:{required:['note']},then:{required:['confirmed']},else:{maxProperties:0}}},required:['answer']};
 let calls=0;
 class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);calls++;return {finalResponse:JSON.stringify(calls===1?{answer:{note:'blocked',confirmed:true}}:{answer:{note:'safe',confirmed:true}}),usage:{output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{answer:{note:'safe',confirmed:true}});assert.equal(calls,2);
});

test('Codex preserves object literal constraints without applying presence wrappers inside equality',async()=>{
 const {default:fc}=await import('fast-check');
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 await fc.assert(fc.asyncProperty(fc.constantFrom('const','enum'),fc.string(),async(keyword,note)=>{
  class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);return {finalResponse:JSON.stringify({answer:{note}}),usage:{output_tokens:1}};}};}}
  const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'object',properties:{note:{type:'string'}},[keyword]:keyword==='enum'?[{note}]:{note}}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
  assert.deepEqual(output.result,{answer:{note}});
 }),{seed:2601102,numRuns:30});
});

test('Codex preserves unconstrained property schemas using JSON text',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 class FakeCodex {startThread(){return {run:async(_task,options)=>{assert.equal(options.outputSchema,undefined);return {finalResponse:'{"answer":{"arbitrary":42}}',usage:{output_tokens:1}};}};}}
 const output=await codexAgent('answer',{schema:{type:'object',properties:{answer:{}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex});
 assert.deepEqual(output.result,{answer:{arbitrary:42}});
});

test('unsupported schema assertion dialects fail before provider startup instead of weakening validation',async()=>{
 let started=false;
 const query=()=>{started=true;return (async function*(){yield {type:'result',subtype:'success',structured_output:{a:1},usage:{output_tokens:1}};})();};
 await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{a:{type:'integer'},b:{type:'integer'}},required:['a'],dependentRequired:{a:['b']}}},{runDir:process.cwd(),query}),/invalid JSON Schema.*dependentRequired/);
 assert.equal(started,false);
});

test('standard email formats are validated and repaired instead of ignored',async()=>{
 let calls=0;
 const query=()=> (async function*(){calls++;yield {type:'result',subtype:'success',structured_output:{email:calls===1?'not-an-email':'reader@example.com'},usage:{output_tokens:1}};})();
 const output=await claudeAgent('answer',{schema:{type:'object',properties:{email:{type:'string',format:'email'}},required:['email']}},{runDir:process.cwd(),query});
 assert.deepEqual(output.result,{email:'reader@example.com'});assert.equal(calls,2);
});

test('unknown formats fail preflight while standard schema annotations remain accepted',async()=>{
 let started=false;
 await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{type:'string',format:'unsupported-private-format'}},required:['answer']}},{runDir:process.cwd(),query:()=>{started=true;throw Error('provider must not start');}}),/invalid JSON Schema.*unknown format/);
 assert.equal(started,false);
 const query=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{answer:42},usage:{output_tokens:1}};})();
 const output=await claudeAgent('answer',{schema:{type:'object',title:'Answer',description:'Annotated result',$comment:'Documentation only',examples:[{answer:42}],deprecated:false,properties:{answer:{type:'integer',default:42,readOnly:true,writeOnly:false}},required:['answer']}},{runDir:process.cwd(),query});
 assert.deepEqual(output.result,{answer:42});
});

test('independent schema requests can reuse an id with revised constraints',async()=>{
 for(const [type,answer] of [['integer',1],['string','revised']]) {
  const query=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{answer},usage:{output_tokens:1}};})();
  const output=await claudeAgent('answer',{schema:{$id:'https://schema.example.test/revised-result',type:'object',properties:{answer:{type}},required:['answer']}},{runDir:process.cwd(),query});
  assert.deepEqual(output.result,{answer});
 }
});

test('a schema cannot resolve references from an earlier independent provider request',async()=>{
 const query=()=> (async function*(){yield {type:'result',subtype:'success',structured_output:{answer:1},usage:{output_tokens:1}};})();
 await claudeAgent('answer',{schema:{$id:'https://schema.example.test/ambient',type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),query});
 let started=false;
 await assert.rejects(claudeAgent('answer',{schema:{type:'object',properties:{answer:{$ref:'https://schema.example.test/ambient#/properties/answer'}},required:['answer']}},{runDir:process.cwd(),query:()=>{started=true;throw Error('provider must not start');}}),/invalid JSON Schema.*resolve reference/);
 assert.equal(started,false);
});

test('asynchronous schemas fail preflight before any provider can start',async()=>{
 let started=false;
 await assert.rejects(claudeAgent('answer',{schema:{$async:true,type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),query:()=>{started=true;throw Error('provider must not start');}}),/invalid JSON Schema.*async/);
 assert.equal(started,false);
});
