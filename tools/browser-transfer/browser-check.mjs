// Two-origin browser emulation against the previous private and new public county artifacts. No personal data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {chromium, expect} = await import(pathToFileURL(resolve(root,'webApp/node_modules/@playwright/test/index.mjs')));
const oldOrigin='https://trail-mapper-private.hooware.chatgpt.site', newOrigin='https://constitution-trail-mapper.hooware.chatgpt.site';
const oldDist=process.argv[2],newDist=process.argv[3];
if(!oldDist||!newDist)throw Error('Usage: node tools/browser-transfer/browser-check.mjs previous-private-dist public-dist');
const source=await readFile(resolve(root,'tools/browser-transfer/transfer.js'),'utf8');
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());const base=u.origin===oldOrigin?oldDist:u.origin===newOrigin?newDist:null;
  if(!base)return route.abort();
  const path=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));
  if(path.split('/').includes('..'))return route.abort();
  try {const body=await readFile(resolve(base,path));const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm'}[extname(path)]||'application/octet-stream';await route.fulfill({body,contentType:mime});}catch {await route.fulfill({status:404,body:'Not found'});}
 });
 const page=await context.newPage();
 await page.goto(oldOrigin+'/');
 await page.getByRole('button',{name:/Go somewhere/}).click();
 for(const [field,name] of [['Start','Tipton Park'],['Destination','Hershey Road']]){
  await page.getByRole('button',{name:new RegExp('^'+field+':')}).click();await page.getByRole('textbox',{name:'Search places'}).fill(name);await page.getByRole('dialog').getByRole('button',{name:new RegExp(name,'i')}).click();
 }
 await page.getByRole('button',{name:'Find route',exact:true}).click();await page.getByRole('heading',{name:'Route preview',exact:true}).waitFor({timeout:45000});
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('button',{name:'Saved · View'})).toBeVisible();
 await page.goto(oldOrigin+'/provenance.json'); // No app writers during synthetic backup setup.
 const key='trail-mapper.county:trail-mapper.web.library.v1';
 await page.evaluate(key=>{
  const lib=JSON.parse(localStorage.getItem(key));lib.recent=[{...lib.saved[0],key:'migration-recent',title:'Migration recent control',usedAt:Date.now()}];lib.places=[{key:'migration-place',label:'Migration place control',latitude:40.5,longitude:-88.99,createdAt:Date.now()}];localStorage.setItem(key,JSON.stringify(lib));
  const sessionKey='trail-mapper.county:trail-mapper.web.session.v1';const session=JSON.parse(localStorage.getItem(sessionKey));session.screen='planner';session.selected=null;session.draft.miles=7.5;localStorage.setItem(sessionKey,JSON.stringify(session));
 },key);
 await page.evaluate(source);
 const backup=await page.evaluate(()=>trailMapperTransfer.capture());
 // Active recovery, unknown keys, conflicts and quota rollback controls run inside an actual browser.
 await page.evaluate(()=>{const k='trail-mapper.county:trail-mapper.web.active-ride.v1';localStorage.setItem(k,'{}');try{trailMapperTransfer.capture();throw Error('accepted active ride');}catch(e){if(!e.message.includes('Stop the ride'))throw e;}finally{localStorage.removeItem(k);}localStorage.setItem('unknown-settings','{}');try{trailMapperTransfer.capture();throw Error('accepted unknown key');}catch(e){if(!e.message.includes('Unknown app'))throw e;}finally{localStorage.removeItem('unknown-settings');}});
 await page.goto(newOrigin+'/browser-transfer.html');await page.evaluate(source);
 assert.equal(await page.locator('script').count(),0,'Transfer page must not load the app');
 await page.evaluate(({backup,key})=>{localStorage.setItem(key,'conflict');try{trailMapperTransfer.restore(backup);throw Error('accepted conflict');}catch(e){if(!e.message.includes('different app data'))throw e;}finally{localStorage.removeItem(key);}}, {backup,key});
 await page.evaluate(backup=>{const original=Storage.prototype.setItem;let n=0;Storage.prototype.setItem=function(k,v){if(++n===2)throw Error('quota control');return original.call(this,k,v);};try{trailMapperTransfer.restore(backup);throw Error('accepted quota failure');}catch(e){if(!e.message.includes('quota control'))throw e;}finally{Storage.prototype.setItem=original;}if(Object.keys(localStorage).length)throw Error('rollback left app data');},backup);
 const recovery='trail-mapper.county:trail-mapper.web.carried-ride.v1';
 await page.evaluate(({backup,recovery})=>trailMapperTransfer.restore({...backup,entries:[...backup.entries,{key:recovery,value:'{}'}]}),{backup,recovery});
 await page.reload();await page.evaluate(source);
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),recovery),null);
 for(const {key,value} of backup.entries)assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),value,'Raw import after reload');
 await page.goto(newOrigin+'/');
 await expect(page.getByRole('button',{name:'Find route',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Start:/})).toContainText('Tipton Park');
 await expect(page.getByRole('button',{name:/^Destination:/})).toContainText('Hershey Road');
 const session=JSON.parse(await page.evaluate(()=>localStorage.getItem('trail-mapper.county:trail-mapper.web.session.v1')));assert.equal(session.draft.miles,7.5);
 await page.getByRole('button',{name:'Trail Mapper home',exact:true}).click();
 await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.getByRole('heading',{name:'Saved routes',exact:true})).toBeVisible();await expect(page.getByText('Migration place control',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Recent',exact:true}).click();await expect(page.getByText('Migration recent control',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Saved',exact:true}).click();
 const after=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(after.saved.length,1);assert.equal(after.recent.length,1);assert.equal(after.places.length,1);
 console.log('Two-origin actual county artifact transfer passed: saved route, recent, place, planner preferences; active/unknown/conflict/quota/recovery controls. Browser emulation only.');
}finally{await browser.close();}
