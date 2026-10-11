import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {submit,networkPrefix} from '../lib/submissions.mjs';
function adapter(sqlite){return {prepare(sql){return {bind(...values){return {sql,values,first:async()=>sqlite.prepare(sql).get(...values)||null};}};},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{for(const s of statements)sqlite.prepare(s.sql).run(...s.values);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
function request(value,changes={}){return new Request('https://trail.example/api/support',{method:'POST',headers:{Origin:'https://trail.example','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.10',...changes},body:JSON.stringify(value)});}
const sample=(kind='feedback')=>({id:randomUUID(),kind,message:'SYNTHETIC TEST ONLY: clear mobile feedback form.',website:''});
function initialized(){const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return sqlite;}
test('real SQLite persistence, retrieval after reopening, concurrent retry and receipt conflict',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'trail-feedback-'));const path=join(directory,'test.sqlite');let sqlite=new DatabaseSync(path);
 try{for(const migration of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));const db=adapter(sqlite),value=sample();
 const responses=await Promise.all([submit(request(value),db),submit(request(value),db)]);for(const r of responses){assert(r.ok);assert.equal((await r.json()).receipt,value.id);}assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback_submissions').get().n,1);
 const feature=sample('feature_request');assert.equal((await submit(request(feature),db)).status,201);sqlite.close();sqlite=new DatabaseSync(path);const rows=sqlite.prepare('SELECT id,kind,message FROM feedback_submissions ORDER BY kind').all();assert.equal(rows.length,2);assert(rows.every(r=>r.message.startsWith('SYNTHETIC TEST ONLY')));assert.deepEqual(rows.map(r=>r.kind),['feature_request','feedback']);
 assert.equal((await submit(request({...value,message:'SYNTHETIC TEST ONLY: changed same receipt'}),adapter(sqlite))).status,409);
 }finally{sqlite.close();rmSync(directory,{recursive:true});}
});
test('clock-window counters, IPv6 prefix, maintenance and rejected traffic remain bounded',async()=>{
 const sqlite=initialized();try{const db=adapter(sqlite);let batches=0;const counted={...db,batch:async s=>{batches++;return db.batch(s);}};const now=Date.UTC(2026,9,11,12,30),day=Math.floor(now/86400000);
 assert.equal(networkPrefix('2001:db8:1234:5678::1'),networkPrefix('2001:db8:1234:5678::ffff'));assert.equal(networkPrefix('::ffff:192.0.2.10'),'192.0.2.10');assert.equal(networkPrefix('malformed'),null);
 const replay=sample();assert.equal((await submit(request(replay),counted,now)).status,201);for(let i=1;i<5;i++)assert.equal((await submit(request(sample()),counted,now)).status,201);assert.equal((await submit(request(replay),counted,now)).status,200);
 const rejected=await submit(request(sample()),counted,now);assert.equal(rejected.status,429);assert.equal(rejected.headers.get('Retry-After'),'1800');assert.equal(batches,5);
 assert.equal((await submit(request(sample()),counted,now+3600000)).status,201);
 assert.equal(sqlite.prepare('SELECT count FROM submission_limits WHERE key=?').get('day:'+day).count,6);
 sqlite.prepare('UPDATE submission_limits SET count=100 WHERE key=?').run('day:'+day);const daily=await submit(request(sample()),counted,now);assert.equal(daily.status,429);assert.equal((await daily.json()).error,'day_limit_reached');assert.equal(batches,6);assert.equal((await submit(request(replay),counted,now)).status,200);
 const next=now+86400000;assert.equal((await submit(request(sample()),counted,next)).status,201);
 const old=sample();sqlite.prepare('INSERT INTO feedback_submissions (id,kind,message,created_at,body_hash,counted) VALUES (?,?,?,?,?,1)').run(old.id,old.kind,old.message,next-91*86400000,'synthetic');const aging=sample();sqlite.prepare('INSERT INTO feedback_submissions (id,kind,message,created_at,body_hash,counted) VALUES (?,?,?,?,?,1)').run(aging.id,aging.kind,aging.message,next-3*86400000,'synthetic');
 assert.equal((await submit(request(sample()),counted,next+86400000)).status,201);assert.equal(sqlite.prepare('SELECT id FROM feedback_submissions WHERE id=?').get(old.id),undefined);assert.equal(sqlite.prepare('SELECT id FROM feedback_submissions WHERE id=?').get(aging.id).id,aging.id);assert(!sqlite.prepare('PRAGMA table_info(feedback_submissions)').all().some(c=>c.name==='rate_key'));
 assert.equal((await submit(request({...sample(),id:[randomUUID()]}),counted,next)).status,400);assert.equal((await submit(request({...sample(),message:'SYNTHETIC TEST ONLY\u000bcontrol'}),counted,next)).status,400);
 const noOrigin=request(sample());noOrigin.headers.delete('Origin');assert.equal((await submit(noOrigin,counted,next)).status,403);const noAddress=request(sample());noAddress.headers.delete('CF-Connecting-IP');assert.equal((await submit(noAddress,counted,next)).status,503);
 }finally{sqlite.close();}
});
test('bounded spam, invalid input, foreign origins and storage failures never report success',async()=>{
 const sqlite=new DatabaseSync(':memory:');try{for(const migration of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));const db=adapter(sqlite);
 for(let i=0;i<5;i++)assert.equal((await submit(request(sample()),db)).status,201);
 const value=sample();assert.equal((await submit(request(value),db)).status,429);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback_submissions').get().n,5);
 for(const bad of [{...value,message:'short'},{...value,website:'bot.example'},{...value,kind:'unknown'},{...value,message:'x'.repeat(4001)},{...value,extra:true}])assert.equal((await submit(request(bad),db)).status,400);
 assert.equal((await submit(request(value,{Origin:'https://evil.example'}),db)).status,403);
 assert.equal((await submit(request(value,{'Content-Type':'text/plain'}),db)).status,415);
 assert.equal((await submit(request(value),null)).status,503);
 const broken={prepare(){throw Error('synthetic unavailable');}};const failure=await submit(request(value),broken);assert.equal(failure.status,503);assert.equal((await failure.json()).saved,undefined);
 assert.equal((await submit(request({...value,message:'x'.repeat(19000)}),db)).status,413);
 }finally{sqlite.close();}
});
