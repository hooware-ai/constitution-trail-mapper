const encoder = new TextEncoder();
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
export function networkPrefix(ip){
 if(typeof ip!=='string'||ip.length>64)return null;
 if(!ip.includes(':')){const parts=ip.split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)?parts.map(Number).join('.'):null;}
 try{const canonical=new URL('http://['+ip+']/').hostname.slice(1,-1);const [left,right]=canonical.split('::');const a=left?left.split(':'):[],b=right?right.split(':'):[];const full=right===undefined?a:[...a,...Array(8-a.length-b.length).fill('0'),...b];if(full.length!==8)return null;const nums=full.map(p=>parseInt(p,16));if(nums.slice(0,5).every(n=>n===0)&&nums[5]===0xffff)return [nums[6]>>8,nums[6]&255,nums[7]>>8,nums[7]&255].join('.');return nums.slice(0,4).map(n=>n.toString(16)).join(':')+'::/64';}catch{return null;}
}
export async function submit(request, db, now = Date.now()) {
  if(request.method !== 'POST') return json({error:'method_not_allowed'},405,{Allow:'POST'});
  const url=new URL(request.url);
  if(request.headers.get('Origin') !== url.origin) return json({error:'origin_rejected'},403);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({error:'json_required'},415);
  const length=Number(request.headers.get('Content-Length')||0);
  if(length>18000) return json({error:'too_large'},413);
  const reader=request.body?.getReader();let bytes=0;const chunks=[];
  if(!reader) return json({error:'invalid_input'},400);
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>18000){await reader.cancel();return json({error:'too_large'},413);}chunks.push(value);}}catch{return json({error:'temporarily_unavailable'},503);}
  let input;try{const merged=new Uint8Array(bytes);let offset=0;for(const c of chunks){merged.set(c,offset);offset+=c.length;}input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(merged));}catch{return json({error:'invalid_input'},400);}
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['id','kind','message','website'].includes(k))||typeof input.id!=='string'||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.id)||!['feedback','feature_request'].includes(input.kind)||typeof input.message!=='string'||typeof input.website!=='string'||input.website!=='' ) return json({error:'invalid_input'},400);
  const message=input.message.trim();if(message.length<10||message.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)||Array.from(message).some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff))return json({error:'invalid_input'},400);
  const ip=networkPrefix(request.headers.get('CF-Connecting-IP'));
  if(!db||!ip) return json({error:'temporarily_unavailable'},503,{'Retry-After':'60'});
  const bodyHash=await digest(JSON.stringify([input.kind,message]));
  try {
    const existing=await db.prepare('SELECT body_hash FROM feedback_submissions WHERE id = ?').bind(input.id).first();
    if(existing)return existing.body_hash===bodyHash?json({saved:true,receipt:input.id},200):json({error:'receipt_conflict'},409);
    const day=Math.floor(now/86400000),hour=Math.floor(now/3600000),dayKey='day:'+day,rateKey='network:'+hour+':'+await digest(ip+'|'+day);
    const limited=async()=>{const daily=await db.prepare('SELECT count FROM submission_limits WHERE key = ?').bind(dayKey).first();if((daily?.count||0)>=100)return json({error:'day_limit_reached'},429,{'Retry-After':String(Math.max(1,Math.ceil(((day+1)*86400000-now)/1000)))});const hourly=await db.prepare('SELECT count FROM submission_limits WHERE key = ?').bind(rateKey).first();if((hourly?.count||0)>=5)return json({error:'network_limit_reached'},429,{'Retry-After':String(Math.max(1,Math.ceil(((hour+1)*3600000-now)/1000)))});return null;};
    const rejected=await limited();if(rejected)return rejected;
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO submission_limits (key,count,expires_at) VALUES (?,0,?)').bind(dayKey,(day+3)*86400000),
      db.prepare('INSERT OR IGNORE INTO submission_limits (key,count,expires_at) SELECT ?,0,? WHERE (SELECT count FROM submission_limits WHERE key = ?) < 100 AND NOT EXISTS (SELECT 1 FROM feedback_submissions WHERE id = ?)').bind(rateKey,(hour+49)*3600000,dayKey,input.id),
      db.prepare(`INSERT INTO feedback_submissions (id,kind,message,created_at,body_hash,counted) SELECT ?,?,?,?,?,0 WHERE (SELECT count FROM submission_limits WHERE key = ?) < 100 AND (SELECT count FROM submission_limits WHERE key = ?) < 5 ON CONFLICT(id) DO NOTHING`).bind(input.id,input.kind,message,now,bodyHash,dayKey,rateKey),
      db.prepare('UPDATE submission_limits SET count = count + 1 WHERE key IN (?,?) AND EXISTS (SELECT 1 FROM feedback_submissions WHERE id = ? AND body_hash = ? AND counted = 0)').bind(dayKey,rateKey,input.id,bodyHash),
      db.prepare('UPDATE feedback_submissions SET counted = 1 WHERE id = ? AND body_hash = ?').bind(input.id,bodyHash),
      db.prepare('INSERT OR IGNORE INTO submission_limits (key,count,expires_at) VALUES (?,0,?)').bind('maintenance:'+day,(day+3)*86400000),
      db.prepare('DELETE FROM feedback_submissions WHERE created_at < ? AND (SELECT count FROM submission_limits WHERE key = ?) = 0').bind(now-90*86400000,'maintenance:'+day),
      db.prepare('DELETE FROM submission_limits WHERE expires_at < ? AND (SELECT count FROM submission_limits WHERE key = ?) = 0').bind(now,'maintenance:'+day),
      db.prepare('UPDATE submission_limits SET count = 1 WHERE key = ?').bind('maintenance:'+day)
    ]);
    const saved=await db.prepare('SELECT body_hash FROM feedback_submissions WHERE id = ?').bind(input.id).first();
    if(!saved)return await limited()||json({error:'limit_reached'},429,{'Retry-After':'60'});
    if(saved.body_hash!==bodyHash)return json({error:'receipt_conflict'},409);
    return json({saved:true,receipt:input.id},201);
  } catch {return json({error:'temporarily_unavailable'},503,{'Retry-After':'60'});}
}
