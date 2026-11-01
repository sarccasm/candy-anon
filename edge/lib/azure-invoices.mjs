// Durable invoice records: no customer PII. Requires preprovisioned private Azure Table.
import { validToken } from './encrypted-fulfillment.mjs';
export class AzureInvoiceStore {
  constructor(client) { if(!client?.createEntity||!client?.getEntity||!client?.updateEntity) throw Error('invalid_client');this.client=client; }
  async create(invoice) {
    if(!validToken(invoice?.token)||typeof invoice.address!=='string'||
      !Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0) throw Error('invalid_invoice');
    const row={partitionKey:'invoices',rowKey:invoice.token,payload:JSON.stringify(invoice),version:1};
    try{await this.client.createEntity(row);}catch(e){if(e.statusCode===409)throw Error('invoice_exists');throw e;}
    return invoice;
  }
  async read(token) {
    if(!validToken(token))return null;
    try {
      const e=await this.client.getEntity('invoices',token);
      return {...JSON.parse(e.payload),_etag:e.etag,_version:e.version};
    }catch(e){if(e.statusCode===404)return null;throw e;}
  }
  async compareAndSwap(token,expectedEtag,updater) {
    const before=await this.read(token);
    if(!before)throw Error('not_found');
    if(before._etag!==expectedEtag)throw Error('version_conflict');
    const next=updater(structuredClone(before));
    if(!next||next.token!==token||next.address!==before.address||
      next.amountSats!==before.amountSats||next.createdAt!==before.createdAt||
      JSON.stringify(next.items)!==JSON.stringify(before.items)||
      next.committed!==before.committed||next.settledSats!==before.settledSats)
      throw Error('invalid_update');
    const { _etag, _version, ...clean }=next;
    try {
      await this.client.updateEntity({partitionKey:'invoices',rowKey:token,
        payload:JSON.stringify(clean),version:before._version+1},'Replace',{etag:expectedEtag});
    }catch(e){if([409,412].includes(e.statusCode))throw Error('version_conflict');throw e;}
    return clean;
  }
}
let singleton;
export async function invoiceStoreFromEnvironment() {
  if(singleton)return singleton;
  const connection=process.env.AZURE_STORAGE_CONNECTION_STRING;
  const table=process.env.AZURE_INVOICES_TABLE;
  if(!connection||!table||!/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(table))throw Error('invoice_store_not_configured');
  const {TableClient}=await import('@azure/data-tables');
  singleton=new AzureInvoiceStore(TableClient.fromConnectionString(connection,table));
  return singleton;
}
