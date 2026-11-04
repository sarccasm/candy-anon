import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from '../frontend/node_modules/vite/dist/node/index.js';

test('loopback dev server denies private workspace files and does not bundle its API capability',async()=>{
 const previous=process.env.LOCAL_API_KEY,capability='test-server-only-key-01234567890123456789';
 process.env.LOCAL_API_KEY=capability;
 const server=await createServer({root:fileURLToPath(new URL('../frontend/',import.meta.url)),
  configFile:fileURLToPath(new URL('../frontend/vite.config.js',import.meta.url)),logLevel:'silent',
  server:{host:'127.0.0.1',port:0,hmr:false}});
 try {
  await server.listen();const address=server.httpServer.address(),base='http://127.0.0.1:'+address.port;
  const privatePath=fileURLToPath(new URL('../.local/settings.json',import.meta.url));
  const blocked=await fetch(base+'/@fs'+privatePath);assert.ok([403,404].includes(blocked.status));
  const entry=await fetch(base+'/main.js');assert.equal(entry.status,200);assert.equal((await entry.text()).includes(capability),false);
 } finally {await server.close();if(previous===undefined)delete process.env.LOCAL_API_KEY;else process.env.LOCAL_API_KEY=previous;}
});
