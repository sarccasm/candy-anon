export function committedInvoiceIntegrity(invoice) {
  if (!invoice || typeof invoice!=='object') return false;
  if (invoice.committed!==true) return true;
  return Number.isSafeInteger(invoice.amountSats) && invoice.amountSats>0 &&
    Number.isSafeInteger(invoice.settledSats) && invoice.settledSats>=invoice.amountSats;
}
