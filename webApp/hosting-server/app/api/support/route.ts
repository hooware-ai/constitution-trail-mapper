import {env} from 'cloudflare:workers';
import {submit} from '../../../lib/submissions.mjs';
export const dynamic='force-dynamic';
export function POST(request:Request){return submit(request,env.DB);}
export function GET(){return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});}
