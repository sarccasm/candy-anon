// Permit cleartext transport only to the public-key Azurite emulator on loopback.
// Production storage retains SDK transport security defaults.
export function isLoopbackAzurite(connection) {
  if(typeof connection!=='string')return false;
  const parts=Object.fromEntries(connection.split(';').filter(Boolean).map(part=>{
    const index=part.indexOf('=');return [part.slice(0,index),part.slice(index+1)];
  }));
  if(parts.AccountName!=='devstoreaccount1' ||
    parts.AccountKey!=='Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==')return false;
  const endpoints=['BlobEndpoint','QueueEndpoint','TableEndpoint'].map(key=>parts[key]).filter(Boolean);
  return endpoints.length>0 && endpoints.every(endpoint=>{
    try {const url=new URL(endpoint);return !url.username&&!url.password&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);}
    catch{return false;}
  });
}
export const localStorageOptions=connection=>isLoopbackAzurite(connection)?{allowInsecureConnection:true}:{};
