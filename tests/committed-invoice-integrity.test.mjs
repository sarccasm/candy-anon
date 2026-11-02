import test from 'node:test';
import assert from 'node:assert/strict';
import {committedInvoiceIntegrity} from '../edge/lib/committed-invoice-integrity.mjs';
test('rejects inconsistent previously committed invoices',()=>{
 for(const settledSats of [undefined,null,0,49999,NaN,Infinity,1.5])
  assert.equal(committedInvoiceIntegrity({committed:true,amountSats:50000,settledSats}),false);
});
test('accepts legitimate committed invoice and uncommitted pending invoice',()=>{
 assert.equal(committedInvoiceIntegrity({committed:true,amountSats:50000,settledSats:50000}),true);
 assert.equal(committedInvoiceIntegrity({committed:false,amountSats:50000}),true);
});
