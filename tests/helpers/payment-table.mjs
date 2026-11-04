import { AzureInvoiceStore } from '../../edge/lib/azure-invoices.mjs';

export function paymentTable() {
  const rows=new Map();let revision=0;
  const failure=statusCode=>Object.assign(Error('table_error'),{statusCode});
  const key=row=>row.partitionKey+'/'+row.rowKey;
  const save=row=>rows.set(key(row),{...structuredClone(row),etag:String(++revision)});
  const client={rows,
    async createEntity(row){if(rows.has(key(row)))throw failure(409);save(row);},
    async getEntity(partition,row){const entity=rows.get(partition+'/'+row);if(!entity)throw failure(404);return structuredClone(entity);},
    async updateEntity(row,mode,options){if(rows.get(key(row))?.etag!==options.etag)throw failure(412);save(row);},
    async submitTransaction(actions){
      for(const [operation,row,,options] of actions){
        if(operation==='create' && rows.has(key(row)))throw failure(409);
        if(operation==='update' && rows.get(key(row))?.etag!==options.etag)throw failure(412);
      }
      for(const [,row] of actions)save(row);
    },
    listEntities({queryOptions:{filter}}){
      const lastKey=filter.match(/RowKey gt '([^']*)'/)?.[1];
      if(lastKey===undefined || !filter.includes("PartitionKey eq 'invoices'"))throw Error('bad_filter');
      return {byPage({maxPageSize}){return (async function*(){
        const all=[...rows.values()].filter(row=>row.partitionKey==='invoices' && row.rowKey>lastKey && row.rowKey<'g')
          .sort((a,b)=>a.rowKey.localeCompare(b.rowKey));
        const page=all.slice(0,maxPageSize).map(row=>structuredClone(row));
        if(all.length>page.length)page.continuationToken='more';
        yield page;
      })();}};
    }
  };
  return {client,store:new AzureInvoiceStore(client)};
}
