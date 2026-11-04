import { invoiceStoreFromEnvironment } from './azure-invoices.mjs';
import { calculateLineCents } from './cart-pricing.mjs';

export function validateProducts(products) {
  if (!Array.isArray(products) || products.length > 500) throw Error('invalid_catalog');
  const ids = new Set();
  return products.map(product => {
    if (!product || typeof product.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(product.id) || ids.has(product.id) ||
        typeof product.name !== 'string' || !product.name.trim() || product.name.length > 120 ||
        !Array.isArray(product.tags) || product.tags.length > 20 ||
        product.tags.some(tag => typeof tag !== 'string' || tag.length > 40)) throw Error('invalid_catalog');
    calculateLineCents(product.price, 1);
    if (product.price > 1e6) throw Error('invalid_product_price');
    ids.add(product.id);
    return {id:product.id, name:product.name.trim(), price:product.price,
      tags:[...product.tags], color:typeof product.color === 'string' ? product.color.slice(0,120) : ''};
  });
}
function encode(products) {
  const payload = JSON.stringify(validateProducts(products));
  if (Buffer.byteLength(payload,'utf16le') > 60000) throw Error('catalog_too_large');
  return payload;
}
export class AzureCatalog {
  constructor(client) { this.client = client; }
  async read() {
    const row = await this.client.getEntity('invoices', 'catalog:v1');
    return {products:validateProducts(JSON.parse(row.payload)), version:row.etag};
  }
  async create(products) {
    await this.client.createEntity({partitionKey:'invoices',rowKey:'catalog:v1',payload:encode(products)});
  }
  async updateProduct({id, name, price, tags, version}) {
    const current = await this.read();
    if (typeof version !== 'string' || version !== current.version) throw Error('catalog_conflict');
    const index = current.products.findIndex(product => product.id === id);
    if (index < 0) throw Error('product_not_found');
    const products = validateProducts(current.products.map(product => product.id === id
      ? {...product, name:name ?? product.name, price:price ?? product.price, tags:tags ?? product.tags} : product));
    try {
      await this.client.updateEntity({partitionKey:'invoices',rowKey:'catalog:v1',payload:encode(products)},
        'Replace',{etag:version});
    } catch (error) {
      if ([409,412].includes(error.statusCode)) throw Error('catalog_conflict');
      throw error;
    }
    return products[index];
  }
}
export async function catalogFromEnvironment() {
  return new AzureCatalog((await invoiceStoreFromEnvironment()).client);
}
export async function getCatalogProducts() {
  return (await (await catalogFromEnvironment()).read()).products;
}
