export function calculateLineCents(price,quantity) {
  if (typeof price!=='number' || !Number.isFinite(price) || price<=0 ||
      !Number.isSafeInteger(quantity) || quantity<=0) throw Error('invalid_product_price');
  const cents=Math.round(price*100);
  if (!Number.isSafeInteger(cents) || cents<=0 ||
      Math.abs(price*100-cents)>0.000001) throw Error('invalid_product_price');
  const total=cents*quantity;
  if (!Number.isSafeInteger(total)) throw Error('invalid_cart_total');
  return total;
}
