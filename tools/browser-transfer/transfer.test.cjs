const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, 'transfer.js'),'utf8');
const key = 'trail-mapper.county:trail-mapper.web.library.v1';
const raw = JSON.stringify({version:1,saved:[{key:'private-item'}],recent:[],places:[]});
function browser(origin, items={},failOn=null) {
 const storage=Object.assign(Object.create(null),items);
 Object.defineProperties(storage,{getItem:{value:k=>storage[k]??null},setItem:{value:(k,v)=>{if(k===failOn)throw Error('quota');storage[k]=v;}},removeItem:{value:k=>delete storage[k]}});
 const ctx=vm.createContext({location:{origin},localStorage:storage});vm.runInContext(code,ctx);return {api:ctx.trailMapperTransfer,storage};
}
const old=browser('https://trail-mapper-private.hooware.chatgpt.site',{[key]:raw,unrelated:'secret'});
const backup=old.api.capture();assert.equal(backup.entries.length,1);assert.equal(old.storage[key],raw);
const fresh=browser('https://constitution-trail-mapper.hooware.chatgpt.site');fresh.api.restore(backup);assert.equal(fresh.storage[key],raw);fresh.api.restore(backup);
const conflict=browser('https://constitution-trail-mapper.hooware.chatgpt.site',{[key]:'different'});assert.throws(()=>conflict.api.restore(backup),/different/);assert.equal(conflict.storage[key],'different');
assert.throws(()=>fresh.api.restore({...backup,entries:[...backup.entries,...backup.entries]}),/duplicate/);
assert.throws(()=>old.api.restore(backup),/new site/);
const active='trail-mapper.county:trail-mapper.web.active-ride.v1';assert.throws(()=>browser('https://trail-mapper-private.hooware.chatgpt.site',{[active]:'{}'}).api.capture(),/Stop/);
const session='trail-mapper.county:trail-mapper.web.session.v1';const quota=browser('https://constitution-trail-mapper.hooware.chatgpt.site',{},session);assert.throws(()=>quota.api.restore({...backup,entries:[...backup.entries,{key:session,value:'{}'}]}),/quota/);assert.equal(quota.storage[key],undefined);
const carried='trail-mapper.county:trail-mapper.web.carried-ride.v1';fresh.api.restore({...backup,entries:[...backup.entries,{key:carried,value:'{}'}]});assert.equal(fresh.storage[carried],undefined);
console.log('8 local transfer controls passed; no network/private browser data used.');
