import vinext from 'vinext';
import {defineConfig} from 'vite';
import {cloudflare} from '@cloudflare/vite-plugin';
import {sites} from './build/sites-vite-plugin';
process.env.CLOUDFLARE_CF_FETCH_ENABLED='false';
process.env.WRANGLER_SEND_METRICS='false';
export default defineConfig({plugins:[vinext(),sites({mockAuth:false}),cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']},inspectorPort:false,config:{main:'./build/sites-worker.ts',compatibility_flags:['nodejs_compat'],observability:{enabled:false},d1_databases:[{binding:'DB',database_name:'trail-feedback-local',database_id:'00000000-0000-4000-8000-000000000000'}]}})]});

