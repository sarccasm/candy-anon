import {reservationActions} from './stock-reservations.mjs';
import {checkoutAdmissionAction} from './checkout-policy.mjs';
import {localStorageOptions} from './local-storage.mjs';
// Durable invoice records: no customer PII. Requires preprovisioned private Azure Table.
import { validToken } from './encrypted-fulfillment.mjs';
import { createHash } from 'node:crypto';
export class AzureInvoiceStore {
  constructor(client) { if(!client?.createEntity||!client?.getEntity||!client?.updateEntity) throw Error('invalid_client');this.client=client; }
  // Never reset or purge this counter, even after an invoice expires.
  async allocateBitcoinIndex() {
    const rowKey = 'btc-address-counter-v1';
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        let row;
        try { row = await this.client.getEntity('invoices', rowKey); }
        catch (error) {
          if (error.statusCode !== 404) throw error;
          await this.client.createEntity({partitionKey:'invoices', rowKey, nextIndex:1});
          return 0;
        }
        if (!Number.isSafeInteger(row.nextIndex) || row.nextIndex < 0 || row.nextIndex >= 0x80000000)
          throw Error('bitcoin_address_space_exhausted');
        await this.client.updateEntity({partitionKey:'invoices', rowKey, nextIndex:row.nextIndex+1},
          'Replace', {etag:row.etag});
        return row.nextIndex;
      } catch (error) {
        if (![409,412].includes(error.statusCode)) throw error;
      }
    }
    throw Error('bitcoin_address_allocation_busy');
  }
  async createWithUniqueAddress(invoice, {reserveStock=false,policy}={}) {
    if (!validToken(invoice?.token) || typeof invoice.address !== 'string' || !invoice.address ||
        !Number.isSafeInteger(invoice.amountSats) || invoice.amountSats <= 0 ||
        invoice.addressAllocationVersion !== 1 || !this.client.submitTransaction)
      throw Error('invalid_invoice');
    const actions=reserveStock?await reservationActions(this,invoice.items):[];
    if(reserveStock){
      if(!policy)throw Error('checkout_policy_required');
      actions.push(checkoutAdmissionAction(policy));
      invoice={...invoice,reservation:{status:'ACTIVE',expiresAt:new Date(Date.parse(invoice.createdAt)+20*60_000).toISOString()}};
    }
    const digest = createHash('sha256').update(invoice.address).digest('hex');
    // A permanent address claim and the invoice are created together, or neither is.
    const reference=createHash('sha256').update('admin-order:'+invoice.token).digest('hex').slice(0,24);
    await this.client.submitTransaction([
      ...actions,
      ...(reserveStock?[['create',{partitionKey:'invoices',rowKey:'order:'+reference,token:invoice.token}]]:[]),
      ['create', {partitionKey:'invoices', rowKey:'btc-address:'+digest, token:invoice.token}],
      ['create', {partitionKey:'invoices', rowKey:invoice.token, payload:JSON.stringify(invoice), version:1}]
    ]);
    return invoice;
  }
  async create(invoice) {
    if(!validToken(invoice?.token)||typeof invoice.address!=='string'||
      !Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0) throw Error('invalid_invoice');
    const row={partitionKey:'invoices',rowKey:invoice.token,payload:JSON.stringify(invoice),version:1};
    try{await this.client.createEntity(row);}catch(e){if(e.statusCode===409)throw Error('invoice_exists');throw e;}
    return invoice;
  }
  async readPaymentScanCursor() {
    const rowKey='worker:payment-scan:v1';
    try { return await this.client.getEntity('invoices',rowKey); }
    catch(error) {
      if(error.statusCode!==404)throw error;
      try { await this.client.createEntity({partitionKey:'invoices',rowKey,lastKey:''}); }
      catch(conflict) { if(conflict.statusCode!==409)throw conflict; }
      return this.client.getEntity('invoices',rowKey);
    }
  }
  async readInvoicePage(lastKey='',limit=3,continuationToken='') {
    if(typeof lastKey!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100)
      throw Error('invalid_scan_config');
    const escaped=lastKey.replaceAll("'","''");
    const pages=this.client.listEntities({queryOptions:{
      filter:`PartitionKey eq 'invoices' and RowKey gt '${escaped}' and RowKey lt 'g'`
    }}).byPage({maxPageSize:limit,continuationToken:continuationToken || undefined});
    const {value:page}=await pages.next();
    // Azure may return an empty page with a continuation token after a scan timeout.
    if(!page?.length)return {tokens:[],nextKey:page?.continuationToken?lastKey:'',
      nextContinuationToken:page?.continuationToken || ''};
    return {tokens:page.map(row=>row.rowKey).filter(validToken),
      nextKey:page.continuationToken?page.at(-1).rowKey:'',nextContinuationToken:''};
  }
  async savePaymentScanCursor(cursor,lastKey,continuationToken='') {
    await this.client.updateEntity({partitionKey:'invoices',rowKey:'worker:payment-scan:v1',lastKey,continuationToken,lastRunAt:new Date().toISOString()},
      'Replace',{etag:cursor.etag});
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
      next.addressAllocationVersion!==before.addressAllocationVersion||
      next.addressIndex!==before.addressIndex||next.addressBranch!==before.addressBranch||
      JSON.stringify(next.items)!==JSON.stringify(before.items)||
      next.committed!==before.committed||next.settledSats!==before.settledSats||
      JSON.stringify(next.pricing)!==JSON.stringify(before.pricing)||next.refundRecordedExternally!==before.refundRecordedExternally||next.operationsRevision!==before.operationsRevision||
      JSON.stringify(next.review)!==JSON.stringify(before.review)||next.committedAt!==before.committedAt||JSON.stringify(next.reservation)!==JSON.stringify(before.reservation))
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
  singleton=new AzureInvoiceStore(TableClient.fromConnectionString(connection,table,localStorageOptions(connection)));
  return singleton;
}
