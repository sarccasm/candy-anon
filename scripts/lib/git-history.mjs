import {execFileSync} from 'node:child_process';
export function historicalBlobs(paths,cwd) {
 const listing=execFileSync('git',['rev-list','--objects','--all','--',...paths],{cwd,encoding:'utf8',maxBuffer:8*1024*1024});
 const objects=new Map();
 for(const line of listing.split('\n')){
  const space=line.indexOf(' ');if(space<0)continue;
  const id=line.slice(0,space),path=line.slice(space+1);
  if(paths.includes(path)&&/^[a-f0-9]{40,64}$/.test(id))objects.set(id,path);
 }
 if(!objects.size)return [];
 const bytes=execFileSync('git',['cat-file','--batch'],{cwd,input:[...objects.keys()].join('\n')+'\n',maxBuffer:64*1024*1024});
 const result=[];let offset=0;
 while(offset<bytes.length){
  const end=bytes.indexOf(10,offset);if(end<0)throw Error('history_parse_failed');
  const [id,type,sizeText]=bytes.subarray(offset,end).toString().split(' '),size=Number(sizeText);
  if(!Number.isSafeInteger(size)||size<0||end+1+size>bytes.length)throw Error('history_parse_failed');
  const content=bytes.subarray(end+1,end+1+size);offset=end+size+2;
  if(type==='blob')result.push({path:objects.get(id),content:content.toString()});
 }
 return result;
}
