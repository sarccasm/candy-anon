import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLineCents} from '../edge/lib/cart-pricing.mjs';
test('exact cents and quantities are calculated without floating point drift',()=>{
 assert.equal(calculateLineCents(19.99,3),5997);
 assert.equal(calculateLineCents(0.1,3),30);
});
test('invalid catalogue values fail closed',()=>{
 for(const [price,qty] of [[0.001,1],[0,1],[-1,1],[NaN,1],[Infinity,1],['1.50',1],[1,0],[1,1.5],[Number.MAX_SAFE_INTEGER,3]])
   assert.throws(()=>calculateLineCents(price,qty),/invalid_product_price|invalid_cart_total/);
});
