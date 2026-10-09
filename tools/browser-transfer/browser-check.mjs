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
 await context.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(success){window.__migrationFix=(latitude,longitude)=>success({coords:{latitude,longitude,accuracy:5,heading:90,speed:4},timestamp:Date.now()});return 1;},clearWatch(){}}}));
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
 await page.evaluate(backup=>{
  const refusal=()=>{try{trailMapperTransfer.restore(backup);throw Error('accepted unsafe page');}catch(e){if(!e.message.includes('dedicated browser-transfer'))throw e;}};
  history.replaceState(null,'','/');refusal();history.replaceState(null,'','/browser-transfer.html');
  const marker=document.querySelector('meta[name="trail-mapper-transfer"]');marker.remove();refusal();document.head.append(marker);
  const script=document.createElement('script');script.type='application/json';document.head.append(script);refusal();script.remove();
  const local=trailMapperTransfer.captureLocal();if(local.sourceOrigin!==location.origin||local.entries.length)throw Error('target capture failed');
 },backup);
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
 await page.getByRole('tab',{name:/^Recent/}).click();await expect(page.getByText('Migration recent control',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:/^Saved/}).click();
 const after=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(after.saved.length,1);assert.equal(after.recent.length,1);assert.equal(after.places.length,1);
 await page.locator('.route-row').first().click();await page.getByRole('heading',{name:'Route preview',exact:true}).waitFor({timeout:45000});
 await expect(page.getByRole('button',{name:'Start navigation',exact:true})).toBeDisabled();
 await expect(page.locator('.navigation-beta-note')).toHaveCount(0);
 await page.getByRole('button',{name:'Trail Mapper home',exact:true}).click();
 await page.getByRole('button',{name:'Help and about',exact:true}).click();const help=page.getByRole('dialog');
 const text=await help.innerText();for(const credit of ['McGIS','U.S. Census','OpenStreetMap','CC BY 4.0','ODbL'])assert(text.includes(credit),credit+' source attribution missing');
 await help.locator('details').filter({hasText:'Routing data downloads and license details'}).locator('summary').click();
 await expect(help.getByRole('link',{name:/Extraction, normalization and graph-construction/})).toHaveCount(1);
 await page.getByRole('button',{name:'Close Help and about'}).click();
 const descriptor=JSON.parse(await readFile(resolve(newDist,'data/dataset.json'),'utf8'));const network=JSON.parse(await readFile(resolve(newDist,'data',descriptor.content.file),'utf8'));
 const feature=network.layers.flatMap(l=>l.features).find(f=>f.id==='54:61');assert(feature,'Actual Northtown trail missing');const path=feature.paths[0];const points=[path[0],path.at(-1)];
 await page.goto(newOrigin+'/browser-transfer.html');
 await page.evaluate(({key,points})=>{const lib=JSON.parse(localStorage.getItem(key));lib.places.push(...points.map(([longitude,latitude],i)=>({key:'mapped-northtown-'+i,label:'Mapped Northtown '+i,latitude,longitude,createdAt:Date.now()})));localStorage.setItem(key,JSON.stringify(lib));},{key,points});
 await page.goto(newOrigin+'/');await page.getByRole('button',{name:/Go somewhere/}).click();
 for(const [field,i] of [['Start',0],['Destination',1]]){const name='Mapped Northtown '+i;await page.getByRole('button',{name:new RegExp('^'+field+':')}).click();await page.getByRole('textbox',{name:'Search places'}).fill(name);await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();}
 await page.getByRole('button',{name:'Find route',exact:true}).click();await page.getByRole('heading',{name:'Route preview',exact:true}).waitFor({timeout:45000});
 await expect(page.getByRole('button',{name:'Start navigation',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Start navigation',exact:true}).click();
 await page.locator('.ride-map-canvas').waitFor({timeout:20000});await expect(page.locator('.navigation-beta-note')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>typeof window.__migrationFix)).toBe('function');await page.evaluate(([lon,lat])=>window.__migrationFix(lat,lon),points[0]);
 await expect(page.locator('.navigation-beta-note')).toHaveText('Navigation is in beta and may experience issues.');
 await page.getByRole('button',{name:'Stop navigation',exact:true}).click();await expect(page.locator('.navigation-beta-note')).toHaveCount(0);
 await expect(page.locator('.review-banner,.test-mode-banner,.access-connections')).toHaveCount(0);await expect(page.locator('.leaflet-control-attribution')).toBeVisible();
 console.log('Strict actual county artifact: imported estimated-gap route blocks Start; mapped Northtown route guides on simulated fresh fix; active-only note/Stop/source credits pass. Physical GPS NOT RUN.');
 console.log('Two-origin actual county artifact transfer passed: saved route, recent, place, planner preferences; active/unknown/conflict/quota/recovery controls. Browser emulation only.');
}finally{await browser.close();}
