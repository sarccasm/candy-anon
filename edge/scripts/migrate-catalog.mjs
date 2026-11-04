import {assertStorageMutationAllowed} from '../../scripts/lib/operation-policy.mjs';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { catalogFromEnvironment, validateProducts } from '../lib/catalog.mjs';

export async function migrateCatalog({state, catalog, apply=false}) {
  const products=validateProducts(state?.products);
  if(!products.length)throw Error('empty_catalog');
  if(!apply)return {dryRun:true,products:products.length};
  // Create-only: an existing durable catalog must never be overwritten by a stale file.
  await catalog.create(products);
  return {dryRun:false,created:products.length};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const args=process.argv.slice(2);
    const apply=args.includes('--apply');
    if(apply)await assertStorageMutationAllowed(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const files=args.filter(arg=>arg!=='--apply');
    if(files.length!==1)throw Error('usage: node scripts/migrate-catalog.mjs <state.json> [--apply]');
    const state=JSON.parse(await readFile(files[0],'utf8'));
    const result=await migrateCatalog({state,apply,catalog:apply?await catalogFromEnvironment():null});
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error('catalog_migration_failed:',error.statusCode===409?'catalog_already_exists':error.message);
    process.exitCode=1;
  }
}
