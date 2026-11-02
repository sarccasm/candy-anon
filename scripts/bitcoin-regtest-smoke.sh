#!/usr/bin/env bash
set -euo pipefail
# Dedicated regtest chain, with no production funds or credentials.
cli() { docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=regtest -rpcpassword=ci-only-regtest-password "$@"; }
for attempt in $(seq 1 60); do
  if cli getblockcount >/dev/null 2>&1; then break; fi
  sleep 2
done
cli getblockcount >/dev/null
cli createwallet miner
ADDRESS=$(cli -rpcwallet=miner getnewaddress)
cli -rpcwallet=miner generatetoaddress 101 "$ADDRESS" >/dev/null
RECEIVER=$(cli -rpcwallet=miner getnewaddress)
TXID=$(cli -rpcwallet=miner sendtoaddress "$RECEIVER" 0.001)
cli -rpcwallet=miner gettransaction "$TXID" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const x=JSON.parse(s);if(x.confirmations!==0)process.exit(1)})'
BLOCK=$(cli -rpcwallet=miner generatetoaddress 1 "$ADDRESS" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0]')
cli -rpcwallet=miner gettransaction "$TXID" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{if(JSON.parse(s).confirmations!==1)process.exit(1)})'
cli invalidateblock "$BLOCK"
cli -rpcwallet=miner gettransaction "$TXID" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{if(JSON.parse(s).confirmations>0)process.exit(1)})'
echo "Regtest confirmed: unconfirmed -> confirmed -> invalidated block."
