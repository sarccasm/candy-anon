import {existsSync} from 'node:fs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=new URL('../',import.meta.url);
const settings=JSON.parse(await readFile(new URL('.local/settings.json',root)));
if(settings.NETWORK!=='regtest')throw Error('local_regtest_settings_required');
const mode=process.argv[2];
if(process.argv.includes('--review-data')){
 const preview=JSON.parse(await readFile(new URL('.local/dataset-migration-preview.json',root)));
 if(preview.localOnly!==true||!/^CandyMigration[a-f0-9]{10}$/.test(preview.tableName))throw Error('invalid_local_preview');
 settings.AZURE_INVOICES_TABLE=preview.tableName;
}

const commands={
 edge:['func',['host','start','--enableAuth','--port','7071',...(settings.LOCAL_FUNCTIONS_CERT?['--useHttps','--cert',settings.LOCAL_FUNCTIONS_CERT,'--password',settings.LOCAL_FUNCTIONS_CERT_PASSWORD_FILE]:[])],new URL('edge/',root)],
 frontend:[process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],new URL('frontend/',root)],
 bridge:[process.execPath,['edge/scripts/regtest-esplora.mjs'],root]
};
if(!commands[mode])throw Error('usage: node scripts/local-run.mjs edge|frontend|bridge');
const [command,args,cwd]=commands[mode];
const localNode=fileURLToPath(new URL('node_modules/node/bin/node',root));
const runtimePath=existsSync(localNode)?path.dirname(localNode)+path.delimiter+process.env.PATH:process.env.PATH;
const child=spawn(command,args,{cwd:fileURLToPath(cwd),env:{...process.env,...settings,PATH:runtimePath},stdio:'inherit'});
child.on('error',error=>{console.error('local_process_failed:',error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code || 0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
