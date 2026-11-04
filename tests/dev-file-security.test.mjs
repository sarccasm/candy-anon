import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from '../frontend/node_modules/vite/dist/node/index.js';

test('loopback dev server denies private workspace files and does not bundle its API capability',async t=>{
 const previous=process.env.LOCAL_API_KEY,capability='test-server-only-key-01234567890123456789';
 process.env.LOCAL_API_KEY=capability;
 t.after(()=>{if(previous===undefined)delete process.env.LOCAL_API_KEY;else process.env.LOCAL_API_KEY=previous;});
 // A clean checkout has no local settings. Own an isolated fixture instead of
 // relying on developer secrets or overwriting the running local environment.
 const localDirectory=fileURLToPath(new URL('../.local/',import.meta.url));
 await mkdir(localDirectory,{recursive:true});
 const fixture=await mkdtemp(join(localDirectory,'vite-security-'));
 t.after(()=>rm(fixture,{recursive:true,force:true}));
 const privatePath=join(fixture,'settings.json'),secret='private-fixture-must-not-be-served';
 await writeFile(privatePath,JSON.stringify({secret}),{mode:0o600});
 const server=await createServer({root:fileURLToPath(new URL('../frontend/',import.meta.url)),
  configFile:fileURLToPath(new URL('../frontend/vite.config.js',import.meta.url)),logLevel:'silent',
  server:{host:'127.0.0.1',port:0,hmr:false}});
 t.after(()=>server.close());
 await server.listen();const address=server.httpServer.address(),base='http://127.0.0.1:'+address.port;
 const blocked=await fetch(base+'/@fs'+privatePath);
 assert.ok([403,404].includes(blocked.status),'existing private fixture must be denied');
 assert.equal((await blocked.text()).includes(secret),false);
 const entry=await fetch(base+'/main.js');assert.equal(entry.status,200);assert.equal((await entry.text()).includes(capability),false);
});
