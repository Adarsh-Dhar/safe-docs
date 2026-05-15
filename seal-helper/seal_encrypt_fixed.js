import { SealClient } from '@mysten/seal';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromHex, toHex } from '@mysten/sui/utils';
import fs from 'fs';
import { randomBytes } from 'crypto';

/**
 * Usage: node seal_encrypt.js <input_path> <policy_id> <output_path>
 * 
 * policy_id: the LeakRecord Sui object ID — controls who can decrypt.
 * Seal key servers will call seal_approve() on the contract before
 * issuing key shares.
 */

const [,, inputPath, policyId, outputPath] = process.argv;

if (!inputPath || !policyId) {
    console.error(JSON.stringify({ 
        success: false, 
        error: 'Usage: node seal_encrypt.js <input_path> <policy_id> [output_path]' 
    }));
    process.exit(1);
}

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
if (!PACKAGE_ID) {
    console.error(JSON.stringify({ success: false, error: 'SUI_PACKAGE_ID env var not set' }));
    process.exit(1);
}

try {
    const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
    
    const fileBytes = fs.readFileSync(inputPath);
    
    // Initialize SealClient with verified testnet key server
    const client = new SealClient({
        suiClient,
        serverConfigs: [
            {
                objectId: '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98',
                weight: 1,
                aggregatorUrl: 'https://seal-aggregator-testnet.mystenlabs.com',
            },
        ],
        verifyKeyServers: false,
    });
    
    // Create ID as combination of policyId and a nonce
    const policyBytes = fromHex(policyId);
    const nonce = randomBytes(32);
    const id = toHex(new Uint8Array([...policyBytes, ...nonce]));
    
    // Encrypt using SealClient
    const result = await client.encrypt({
        threshold: 2,
        packageId: PACKAGE_ID,
        id,
        data: new Uint8Array(fileBytes),
    });
    
    // The encryptedObject is already a Uint8Array from the SDK
    const encryptedBytes = result.encryptedObject;

    // Write encrypted data to file
    const finalOutputPath = outputPath || (inputPath + '.sealed');
    fs.writeFileSync(finalOutputPath, Buffer.from(encryptedBytes));

    // Output result as JSON for Python to parse
    console.log(JSON.stringify({
        success: true,
        output_path: finalOutputPath,
        policy_id: policyId,
        original_size: fileBytes.length,
        encrypted_size: encryptedBytes.length,
    }));

} catch (err) {
    console.error(JSON.stringify({
        success: false,
        error: err.message,
    }));
    process.exit(1);
}
