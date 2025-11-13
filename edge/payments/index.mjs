import { DevAdapter } from "./dev.mjs";
import { BTCPayAdapter } from "./btcpay.mjs";

export function createPaymentsAdapter({ provider, db, ttlMin, env }) {
  if (provider === "btcpay") {
    return BTCPayAdapter({
      db, ttlMin,
      host: env.BTCPAY_HOST,
      storeId: env.BTCPAY_STORE_ID,
      apiKey: env.BTCPAY_API_KEY,
      network: env.BTC_NETWORK || "mainnet"
    });
  }
  return DevAdapter({ db, ttlMin });
}
