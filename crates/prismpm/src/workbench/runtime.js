// Generic Text/3 presentation. Domain parsing, normalization and computation
// remain exclusively in the modeled byte guest.
const VIEW = __VIEW__;
const INPUT_LIMIT = __INPUT_LIMIT__;
const OUTPUT_LIMIT = __OUTPUT_LIMIT__;
const BINDING = __BINDING__;
const TRANSPORT = __TRANSPORT__;
const US = '\u001f';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
function scalarText(value){for(let i=0;i<value.length;i++){const ch=value.charCodeAt(i);if(ch>=0xd800&&ch<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(ch>=0xdc00&&ch<=0xdfff)return false;}return true;}
function utf8Length(value){if(!scalarText(value))return null;let bytes=0;for(const ch of value){const code=ch.codePointAt(0);bytes+=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;if(bytes>INPUT_LIMIT)return bytes;}return bytes;}

// Parse the closed JSON object directly so duplicate keys cannot be hidden by
// JSON.parse's last-key-wins behavior. Arrays contain strings only; the model
// bounds the whole byte response before parsing and every display collection.
export function parseResult(text, operation) {
  if (typeof text !== 'string' || encoder.encode(text).length > OUTPUT_LIMIT) throw new Error('response bound');
  let at = 0;
  const whitespace = () => {while (/^[\t\n\r ]$/.test(text[at] ?? '')) at++;};
  const take = token => {whitespace();if (text[at] !== token) throw new Error('JSON token');at++;};
  const string = () => {
    whitespace();const start=at;if(text[at++]!=='"')throw new Error('JSON string');
    for (;;) {
      const c=text[at++];if(c===undefined)throw new Error('JSON string end');
      if(c==='"')break;if(c==='\\'){if(text[at]===undefined)throw new Error('JSON escape');at++;}
    }
    const value=JSON.parse(text.slice(start,at));
    if(typeof value!=='string'||!scalarText(value))throw new Error('JSON string value');return value;
  };
  const natural = () => {
    whitespace();const match=/^(0|[1-9][0-9]*)/.exec(text.slice(at));if(!match)throw new Error('JSON natural');
    at+=match[0].length;const value=Number(match[0]);if(!Number.isSafeInteger(value))throw new Error('JSON integer bound');return value;
  };
  const strings = maximum => {
    const values=[];take('[');whitespace();if(text[at]===']'){at++;return values;}
    for(;;){if(values.length>=maximum)throw new Error('JSON collection bound');values.push(string());whitespace();if(text[at]===']'){at++;return values;}take(',');}
  };
  const keys=['version','status','operation','message','rows','columns','cells','details','request','response','error'];
  const result=Object.create(null);take('{');
  for(let count=0;;count++) {
    if(count>=keys.length)throw new Error('JSON object bound');
    const key=string();if(!keys.includes(key)||Object.hasOwn(result,key))throw new Error('JSON object key');take(':');
    result[key]=['version','rows','columns'].includes(key)?natural():key==='cells'?strings(VIEW.response.maximum_cells):key==='details'?strings(VIEW.response.maximum_details):string();
    whitespace();if(text[at]==='}'){at++;break;}take(',');
  }
  whitespace();if(at!==text.length||Object.keys(result).length!==keys.length)throw new Error('JSON closure');
  const plain=value=>typeof value==='string'&&value.trim().length>0&&encoder.encode(value).length<=16384&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const shape=result.rows<=VIEW.response.maximum_cells&&result.columns<=VIEW.response.maximum_cells&&result.rows*result.columns===result.cells.length;
  const empty=result.rows===0&&result.columns===0&&result.cells.length===0;
  if(result.version!==1||!['ok','error'].includes(result.status)||result.operation!==operation||!plain(result.message)
    ||!shape||!result.cells.every(plain)||!result.details.every(plain)
    ||(result.status==='ok'?result.error!=='' : !VIEW.errors.some(hint=>hint.code===result.error)||!empty))throw new Error('result contract');
  return result;
}

async function boundedEnvelope(response) {
  if(!response.ok||!response.body)throw new Error('intent response');
  const maximum=OUTPUT_LIMIT*6+256;
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>maximum)){await response.body.cancel();throw new Error('intent bound');}
  const reader=response.body.getReader();const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let text='',total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||value.byteLength>maximum-total)throw new Error('intent bound');total+=value.byteLength;text+=utf8.decode(value,{stream:true});}text+=utf8.decode();const answer=JSON.parse(text);if(answer===null||answer.version!==1||!Array.isArray(answer.outputs)||answer.outputs.length!==1||typeof answer.outputs[0]!=='string')throw new Error('intent envelope');return answer.outputs[0];}
  catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
}

export function mount(root=document.body) {
  const element=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
  const append=(parent,...children)=>{parent.append(...children);return parent;};
  const byId=id=>root.querySelector('#'+id);
  const initialDraft=root.querySelector('#request')?.value;
  const initialFocus=document.activeElement===root.querySelector('#request');
  const initialRawOpen=root.querySelector('#raw-editor')?.open;
  const initialSelection=initialFocus?[root.querySelector('#request').selectionStart,root.querySelector('#request').selectionEnd,root.querySelector('#request').selectionDirection]:null;
  root.replaceChildren();
  document.documentElement.dataset.palette=VIEW.design.palette;document.documentElement.dataset.density=VIEW.design.density;document.documentElement.dataset.width=VIEW.design.width;document.documentElement.dataset.scheme=VIEW.design.color_scheme;
  const skip=element('a',VIEW.labels.skip_to_workbench,{id:'skip-to-workbench',href:'#workbench-main',class:'skip-link'});
  const navigation=append(element('nav',undefined,{'aria-label':VIEW.labels.navigation}),element('a',VIEW.labels.guide,{href:'#guide'}),element('a',VIEW.labels.links,{href:'#links'}));
  const header=append(element('header',undefined,{class:'site-header'}),element('span',VIEW.title,{class:'brand'}),navigation);
  const main=element('main',undefined,{id:'workbench-main',tabindex:'-1'});
  const steps=element('ol',undefined,{class:'guidance'});for(const step of VIEW.guidance)steps.append(element('li',step));
  main.append(append(element('section',undefined,{class:'hero','aria-labelledby':'heading'}),element('h1',VIEW.heading,{id:'heading'}),element('p',VIEW.purpose,{class:'purpose'}),element('p',VIEW.audience,{class:'audience'}),steps));
  const workspace=element('div',undefined,{class:'workspace'});
  const inputs=element('section',undefined,{class:'panel input-panel','aria-labelledby':'fields-heading'});inputs.append(element('h2',VIEW.labels.fields,{id:'fields-heading'}));
  const operation=element('select',undefined,{id:'operation'});for(const item of VIEW.operations)operation.append(element('option',item.label,{value:item.id}));operation.value=VIEW.initial_operation;
  inputs.append(element('label',VIEW.labels.operation,{for:'operation'}),operation,element('p','',{id:'operation-summary',class:'operation-summary'}),element('p','',{id:'operation-help',class:'help'}));
  const example=element('select',undefined,{id:'example'});const loadExample=element('button',VIEW.labels.load_example,{id:'load-example',type:'button',class:'secondary'});
  inputs.append(append(element('div',undefined,{class:'example-picker'}),append(element('div'),element('label',VIEW.labels.examples,{for:'example'}),example),loadExample),element('p','',{id:'example-description',class:'help'}),element('p','',{id:'example-explanation',class:'help'}));
  const expected=append(element('details',undefined,{id:'expected-response',class:'expected'}),element('summary',VIEW.labels.expected_response),element('pre','',{id:'expected-response-json'}));inputs.append(expected);
  const form=element('form',undefined,{id:'guided-form',novalidate:''});const fields=element('div',undefined,{id:'guided-fields',class:'field-grid'});
  const compute=element('button',VIEW.labels.compute,{id:'guided-submit',type:'submit',disabled:''});const reset=element('button',VIEW.labels.reset,{id:'reset',type:'button',class:'secondary'});
  form.append(fields,append(element('div',undefined,{class:'actions'}),compute,reset));inputs.append(form);
  const raw=element('details',undefined,{id:'raw-editor',class:'raw-editor'});raw.open=initialFocus||initialRawOpen===true?true:VIEW.raw.expanded;
  const request=element('textarea',undefined,{id:'request',rows:5,placeholder:VIEW.raw.placeholder,'aria-describedby':'raw-help',spellcheck:'false',autocapitalize:'off'});request.value=initialDraft??VIEW.raw.initial_value;if(initialFocus)queueMicrotask(()=>{request.focus();request.setSelectionRange(...initialSelection);});
  const rawForm=element('form',undefined,{id:'application-form',novalidate:''});const submit=element('button',VIEW.raw.submit_label,{id:'submit',type:'submit',disabled:''});
  rawForm.append(element('label',VIEW.labels.request,{for:'request'}),request,submit);
  raw.append(element('summary',VIEW.raw.label),element('p',VIEW.raw.help,{id:'raw-help',class:'help'}),rawForm);inputs.append(raw);
  const results=element('section',undefined,{class:'panel result-panel','aria-labelledby':'response-heading'});results.append(element('h2',VIEW.response.title,{id:'response-heading'}));
  const status=element('p',VIEW.statuses.initializing,{id:'status',role:'status','aria-live':'polite','aria-atomic':'true',class:'status'});
  const cancel=element('button',VIEW.execution.cancel_label,{id:'cancel',type:'button',class:'secondary',hidden:''});const retry=element('button',VIEW.execution.retry_label,{id:'retry',type:'button',class:'secondary',hidden:''});
  results.append(status,append(element('div',undefined,{class:'actions lifecycle-actions'}),cancel,retry),element('p',VIEW.response.empty_text,{id:'result-empty',class:'empty-state'}),element('p','',{id:'result-message',class:'result-message'}),element('div','',{id:'result-error',role:'alert',hidden:''}));
  const shape=append(element('dl',undefined,{id:'result-shape',class:'result-shape',hidden:''}),element('dt',VIEW.labels.row),element('dd','',{id:'result-rows'}),element('dt',VIEW.labels.column),element('dd','',{id:'result-columns'}));results.append(shape);
  const tableRegion=element('div',undefined,{id:'result-table-region',class:'table-scroll',tabindex:'0',role:'region','aria-label':VIEW.labels.result_table,hidden:''});
  const table=element('table',undefined,{id:'result-table'});tableRegion.append(table);results.append(tableRegion);
  const details=element('ul',undefined,{id:'result-details'});results.append(element('h3',VIEW.labels.details,{id:'details-heading',hidden:''}),details);
  const rawOutput=append(element('details',undefined,{id:'raw-output'}),element('summary',VIEW.response.raw_label),element('h3',VIEW.labels.request),element('pre','',{id:'result-request'}),element('h3',VIEW.raw.response_label),element('pre','',{id:'result'}));results.append(rawOutput);
  workspace.append(inputs,results);main.append(workspace);
  const guide=element('section',undefined,{id:'guide',class:'documentation','aria-labelledby':'guide-heading'});guide.append(element('h2',VIEW.labels.guide,{id:'guide-heading'}));
  for(const section of VIEW.sections){const body=append(element('section',undefined,{id:'guide-'+section.id}),element('h3',section.title));for(const paragraph of section.paragraphs)body.append(element('p',paragraph));guide.append(body);}main.append(guide);
  const links=append(element('footer',undefined,{id:'links'}),element('h2',VIEW.labels.links));for(const link of VIEW.links)links.append(element('a',link.label,{href:link.https_url,rel:'noreferrer'}));main.append(links);root.append(skip,header,main);
  let active=VIEW.operations.find(item=>item.id===VIEW.initial_operation),busy=false,ready=false,engineFailed=false,worker=null,controller=null,epoch=0,generation=0,timer=null,pending=null,last=null,bootAfter=null;
  const fieldNodes=new Map();
  const setStatus=key=>{status.textContent=VIEW.statuses[key];status.dataset.state=key;};
  const updateControls=()=>{compute.disabled=submit.disabled=!ready||busy;cancel.hidden=!busy;for(const node of [form,rawForm,tableRegion]){if(busy)node.setAttribute('aria-busy','true');else node.removeAttribute('aria-busy');}};
  const clearErrors=()=>{byId('result-error').replaceChildren();byId('result-error').hidden=true;for(const [id,node]of fieldNodes){node.removeAttribute('aria-invalid');node.setAttribute('aria-describedby','field-'+id+'-help');}request.removeAttribute('aria-invalid');request.setAttribute('aria-describedby','raw-help');};
  const clearOutput=()=>{clearErrors();byId('result').textContent='';byId('result-request').textContent='';byId('result-message').textContent='';shape.hidden=true;byId('result-rows').textContent='';byId('result-columns').textContent='';byId('result-empty').hidden=false;table.replaceChildren();tableRegion.hidden=true;details.replaceChildren();byId('details-heading').hidden=true;};
  const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const retire=()=>{clearTimer();epoch++;generation++;pending=null;ready=false;worker?.terminate();worker=null;controller?.abort();controller=null;};
  const failure=(key,rawMode=false,node=null)=>{if(key!=='input_error'){engineFailed=!ready;busy=false;clearTimer();}setStatus(key);retry.hidden=key==='input_error'?!engineFailed:false;if(key==='input_error'){const target=node??(rawMode?request:fieldNodes.values().next().value);if(target){target.setAttribute('aria-invalid','true');target.setAttribute('aria-describedby',(target.getAttribute('aria-describedby')??'')+' status');target.focus();}}updateControls();};
  const display=(answer,rawMode)=>{clearErrors();byId('result-empty').hidden=true;byId('result-message').textContent=answer.message;byId('result-request').textContent=answer.request;byId('result').textContent=answer.response;shape.hidden=answer.status!=='ok';byId('result-rows').textContent=answer.status==='ok'?String(answer.rows):'';byId('result-columns').textContent=answer.status==='ok'?String(answer.columns):'';details.replaceChildren(...answer.details.map(text=>element('li',text)));byId('details-heading').hidden=answer.details.length===0;
    table.replaceChildren();tableRegion.hidden=answer.cells.length===0;
    if(answer.cells.length){table.append(element('caption',VIEW.response.title));const head=element('tr');head.append(element('th',VIEW.labels.row+' / '+VIEW.labels.column,{scope:'col'}));for(let column=0;column<answer.columns;column++)head.append(element('th',VIEW.labels.column+' '+(column+1),{scope:'col'}));table.append(append(element('thead'),head));const body=element('tbody');for(let row=0;row<answer.rows;row++){const line=element('tr');line.append(element('th',VIEW.labels.row+' '+(row+1),{scope:'row'}));for(let column=0;column<answer.columns;column++)line.append(element('td',answer.cells[row*answer.columns+column]));body.append(line);}table.append(body);}
    if(answer.status==='error'){const hint=VIEW.errors.find(item=>item.code===answer.error);const area=byId('result-error');area.hidden=false;area.append(element('h3',hint.title),element('p',hint.explanation),element('p',hint.recovery));const targets=rawMode?[request]:hint.fields.map(id=>fieldNodes.get(id)).filter(Boolean);for(const node of targets){node.setAttribute('aria-invalid','true');node.setAttribute('aria-describedby',node.getAttribute('aria-describedby')+' result-error');}targets[0]?.focus();}
  };
  const complete=(text,token)=>{if(!pending||token!==generation)return;const invocation=pending;pending=null;busy=false;clearTimer();try{display(parseResult(text,invocation.operation),invocation.rawMode);setStatus('ready');retry.hidden=true;}catch{failure('response_error');}updateControls();};
  const send=invocation=>{if(!ready||busy)return;clearOutput();last=invocation;pending=invocation;busy=true;const token=++generation;setStatus('running');retry.hidden=true;updateControls();timer=setTimeout(()=>{if(!busy||token!==generation)return;retire();busy=false;failure('timeout');},VIEW.execution.timeout_milliseconds);
    if(TRANSPORT==='browser'){const bytes=encoder.encode(invocation.request);worker.postMessage({type:'invoke',generation:token,input:bytes},[bytes.buffer]);}
    else{const current=epoch;controller=new AbortController();fetch('/_hologram/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,name:'application.invoke',payload:invocation.request}),signal:controller.signal}).then(boundedEnvelope).then(text=>{if(epoch===current)complete(text,token);}).catch(()=>{if(epoch===current&&token===generation){pending=null;failure('compute_error');}});}
  };
  const boot=(after=null,retainedStatus=null)=>{retire();engineFailed=false;busy=false;bootAfter=after;setStatus(retainedStatus??'initializing');updateControls();const current=epoch;
    const initialized=()=>{if(current!==epoch)return;clearTimer();engineFailed=false;ready=true;if(retainedStatus===null)retry.hidden=true;setStatus(retainedStatus??'ready');updateControls();const queued=bootAfter;bootAfter=null;if(queued)send(queued);};
    if(TRANSPORT==='hologram'){initialized();return;}
    timer=setTimeout(()=>{if(current!==epoch)return;retire();failure('timeout');},VIEW.execution.timeout_milliseconds);
    try{worker=new Worker(new URL(import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(current!==epoch)return;if(data?.type==='ready'){initialized();}else if(data?.type==='result'&&data.output instanceof Uint8Array){if(data.generation!==generation||!pending)return;try{if(data.output.byteLength>OUTPUT_LIMIT)throw new Error('response bound');complete(decoder.decode(data.output),data.generation);}catch{pending=null;failure('response_error');}}else if(data?.type==='failure'){if(data.kind==='load'){retire();failure('load_error');}else if(data.generation===generation){pending=null;failure('compute_error');}}};worker.onerror=event=>{event.preventDefault();if(current===epoch){const wasReady=ready;retire();failure(wasReady?'compute_error':'load_error');}};}catch{retire();failure('load_error');}
  };
  const invoke=(rawMode=false)=>{if(busy)return;clearErrors();let values,prefix,operationId;if(rawMode){values=[request.value];prefix=VIEW.raw.request_prefix;operationId='raw';}else{values=active.fields.map(field=>fieldNodes.get(field.id).value);prefix=active.request_prefix;operationId=active.id;}
    for(let index=0;index<values.length;index++){const value=values[index],field=rawMode?null:active.fields[index];if(value.includes(US)||utf8Length(value)===null||(field?.required&&!value.trim())||(field?.kind==='choice'&&!field.choices.some(choice=>choice.value===value))){failure('input_error',rawMode,rawMode?request:fieldNodes.get(field.id));return;}}
    const framedLength=prefix.length+values.length+values.reduce((sum,value)=>sum+utf8Length(value),0);if(framedLength>INPUT_LIMIT){failure('input_error',rawMode);return;}const framed=prefix+US+values.join(US);const invocation={request:framed,operation:operationId,rawMode};if(!ready){boot(invocation);return;}send(invocation);
  };
  const draftChanged=()=>{const wasBusy=busy;if(busy)boot(null,'cancelled');bootAfter=null;clearOutput();last=null;retry.hidden=!engineFailed;if(!wasBusy){if(ready)setStatus('ready');else if(!engineFailed)setStatus('initializing');}};
  const clearExample=()=>{byId('example-description').textContent='';byId('example-explanation').textContent='';byId('expected-response-json').textContent='';example.value='';loadExample.disabled=true;expected.open=false;};
  const load=()=>{const selected=active.examples.find(item=>item.id===example.value);if(!selected)return;if(busy)boot(null,'cancelled');bootAfter=null;for(let index=0;index<active.fields.length;index++)fieldNodes.get(active.fields[index].id).value=selected.values[index];byId('example-description').textContent=selected.description;byId('example-explanation').textContent=selected.explanation;byId('expected-response-json').textContent=selected.expected_response;clearOutput();last=null;retry.hidden=!engineFailed;if(ready)setStatus('ready');else if(!engineFailed)setStatus('initializing');};
  const renderOperation=initial=>{if(busy)boot(null,'cancelled');active=VIEW.operations.find(item=>item.id===operation.value);fieldNodes.clear();fields.replaceChildren();for(const field of active.fields){const id='field-'+field.id;const node=field.kind==='multiline'?element('textarea',undefined,{rows:4}):field.kind==='choice'?element('select'):element('input',undefined,{type:'text',...(field.kind==='natural'?{inputmode:'numeric'}:{})});node.id=id;node.setAttribute('aria-describedby',id+'-help');node.setAttribute('autocomplete','off');if(field.required)node.setAttribute('required','');if(field.kind==='choice')for(const choice of field.choices)node.append(element('option',choice.label,{value:choice.value}));else{node.setAttribute('placeholder',field.placeholder);node.setAttribute('spellcheck','false');}node.value=field.initial_value;fieldNodes.set(field.id,node);const group=append(element('div',undefined,{class:field.kind==='multiline'?'field multiline':'field'}),element('label',field.label,{for:id}),node,element('p',field.help,{id:id+'-help',class:'help'}));fields.append(group);node.addEventListener('input',()=>{clearExample();draftChanged();});}
    byId('operation-summary').textContent=active.summary;byId('operation-help').textContent=active.help;example.replaceChildren(element('option',VIEW.labels.examples,{value:''}),...active.examples.map(item=>element('option',item.label,{value:item.id})));example.value=initial?VIEW.initial_example:active.examples[0].id;loadExample.disabled=example.value==='';clearOutput();load();};
  request.addEventListener('input',draftChanged);example.addEventListener('change',()=>{loadExample.disabled=example.value==='';draftChanged();byId('example-description').textContent='';byId('example-explanation').textContent='';byId('expected-response-json').textContent='';expected.open=false;});
  operation.addEventListener('change',()=>renderOperation(false));loadExample.addEventListener('click',load);form.addEventListener('submit',event=>{event.preventDefault();invoke();});rawForm.addEventListener('submit',event=>{event.preventDefault();invoke(true);});request.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();invoke(true);}});
  cancel.addEventListener('click',()=>{setStatus('cancelling');retire();busy=false;boot(null,'cancelled');retry.hidden=last===null;});retry.addEventListener('click',()=>{const invocation=last;boot(invocation);retry.hidden=true;});reset.addEventListener('click',()=>{if(busy)boot(null,'cancelled');for(const field of active.fields)fieldNodes.get(field.id).value=field.initial_value;clearExample();clearOutput();last=null;retry.hidden=!engineFailed;if(ready)setStatus('ready');else if(!engineFailed)setStatus('initializing');});
  renderOperation(true);boot();return {dispose(){retire();root.replaceChildren();}};
}

async function workerMain() {
  let invoke;
  try{const binding=await import(BINDING);if(typeof binding.default!=='function'||typeof binding.invoke_bytes!=='function')throw new Error('binding exports');await binding.default();invoke=binding.invoke_bytes;self.postMessage({type:'ready'});}catch{self.postMessage({type:'failure',kind:'load'});return;}
  self.onmessage=({data})=>{if(data?.type!=='invoke'||!Number.isSafeInteger(data.generation)||!(data.input instanceof Uint8Array)||data.input.byteLength>INPUT_LIMIT)return;try{const output=invoke(data.input);if(!(output instanceof Uint8Array)||output.byteLength>OUTPUT_LIMIT)throw new Error('response bound');self.postMessage({type:'result',generation:data.generation,output},[output.buffer]);}catch{self.postMessage({type:'failure',kind:'compute',generation:data.generation});}};
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope){if(TRANSPORT==='browser')void workerMain();}
else if(typeof document!=='undefined')mount();
