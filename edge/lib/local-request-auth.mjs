import {timingSafeEqual} from 'node:crypto';
import {json} from './http.mjs';
// Core Tools can bind all interfaces. Keep local regtest APIs behind a server-only
// capability shared with the loopback Vite proxy, never a browser-bundled variable.
export function authorizeLocalRequest(context,req){
 if(process.env.NETWORK!=='regtest'||process.env.REQUIRE_LOCAL_API_KEY!=='true'||req.method==='OPTIONS')return true;
 const expected=process.env.LOCAL_API_KEY || '',provided=req.headers?.['x-local-api-key'] || '';
 if(typeof provided==='string'&&expected.length>=32){
  const a=Buffer.from(provided),b=Buffer.from(expected);
  if(a.length===b.length&&timingSafeEqual(a,b))return true;
 }
 context.res ??= {};json(context.res,{error:'local_access_required'},403);return false;
}
