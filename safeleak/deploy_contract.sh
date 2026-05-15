#!/bin/bash
set -e

echo "=== SafeLeak Contract Deployment ==="

# Check sui CLI
if ! command -v sui &> /dev/null; then
    echo "ERROR: sui CLI not found. Install from:"
    echo "  cargo install --locked --git https://github.com/MystenLabs/sui.git --branch testnet sui"
    exit 1
fi

# Switch to testnet
sui client switch --env testnet 2>/dev/null || {
    sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
    sui client switch --env testnet
}

echo "Active env: $(sui client active-env)"
echo "Active address: $(sui client active-address)"

# Get testnet SUI if needed
BALANCE=$(sui client balance --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['totalBalance'] if d else '0')" 2>/dev/null || echo "0")
echo "Current balance: $BALANCE MIST"

if [ "$BALANCE" = "0" ] || [ "$BALANCE" = "" ]; then
    echo "Requesting testnet SUI from faucet..."
    sui client faucet
    sleep 5
fi

# Build and publish
echo "Building contract..."
cd "$(dirname "$0")/../safeleak_contract"
sui move build

echo "Publishing contract..."
PUBLISH_OUTPUT=$(sui client publish --gas-budget 200000000 --json)
echo "$PUBLISH_OUTPUT" > ../safeleak/contract_deployment.json

# Extract package ID
PACKAGE_ID=$(echo "$PUBLISH_OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for obj in data.get('objectChanges', []):
    if obj.get('type') == 'published':
        print(obj['packageId'])
        break
")

echo ""
echo "=== DEPLOYMENT SUCCESS ==="
echo "PACKAGE_ID: $PACKAGE_ID"
echo ""
echo "Add to safeleak/.env:"
echo "SUI_PACKAGE_ID=$PACKAGE_ID"
echo "SUI_NETWORK=testnet"
