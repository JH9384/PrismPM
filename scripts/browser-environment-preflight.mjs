// Environment readiness only; never product, oracle or application acceptance.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserPins,withBrowser} from '../sdk/browser/browser-test-server.mjs';

export function validateBrowserEnvironment(value) {
  assert.deepEqual(Object.keys(value).sort(),['engines','schema']);
  assert.equal(value.schema,'prismpm/browser-environment/1');
  assert.deepEqual(value.engines.map(row=>row.engine),Object.keys(browserPins));
  for(const row of value.engines) {
    assert.deepEqual(Object.keys(row).sort(),['engine','evaluated','version']);
    assert.equal(row.version,browserPins[row.engine].version);
    assert.equal(row.evaluated,true);
  }
}

export async function browserEnvironmentPreflight(launch=withBrowser) {
  const engines=[];
  for(const engine of ['chromium','firefox','webkit']) {
    try {
      const row=await launch(async({browser,baseURL})=>{
        const version=browser.version();assert.equal(version,browserPins[engine].version);
        const page=await browser.newPage();
        try {
          const response=await page.goto(baseURL,{waitUntil:'load',timeout:15000});
          assert.equal(response.status(),200);
          const observed=await page.evaluate(()=>({title:document.title,origin:location.origin,
            ready:document.readyState,value:[2,3].reduce((left,right)=>left+right,0)}));
          assert.deepEqual(observed,{title:'Browser primitive acceptance',origin:new URL(baseURL).origin,
            ready:'complete',value:5});
          return Object.freeze({engine,version,evaluated:true});
        } finally {await page.close();}
      },{engine});
      engines.push(row);
    } catch(cause) {throw new Error(`browser environment preflight failed: ${engine}`,{cause});}
  }
  const result=Object.freeze({schema:'prismpm/browser-environment/1',engines:Object.freeze(engines)});
  validateBrowserEnvironment(result);
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,2,'browser preflight accepts no engine override or omission');
  console.log(JSON.stringify(await browserEnvironmentPreflight()));
}
