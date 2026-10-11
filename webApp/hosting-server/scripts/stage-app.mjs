import {readFile,mkdir,rm,cp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const source=resolve('../dist'),p=JSON.parse(await readFile(source+'/provenance.json','utf8'));
if(p.build.assumeEstimatedConnections!==false||p.dataset.kind!=='county'||p.dataset.approved!==true)throw Error('Feedback host requires the reviewed strict county app');
for(const f of p.files){const b=await readFile(source+'/'+f.path);if(createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('App bytes differ: '+f.path);}
await rm('public',{recursive:true,force:true});await cp(source,'public',{recursive:true});
await writeFile('trail.html',await readFile('public/index.html'));await rm('public/index.html');
console.log(JSON.stringify({appCommit:p.source.commit,dirty:p.source.dirty,appFiles:p.files.length,filesSha256:p.filesSha256}));
