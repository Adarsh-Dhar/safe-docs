import { SealClient, getAllowlistedKeyServers, EncryptedObject } from '@mysten/seal';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';
import path from 'path';

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
    
    const sealClient = new SealClient({
        suiClient,
        // Use the official Mysten Labs testnet key servers
        serverObjectIds: getAllowlistedKeyServers('testnet'),
        verifyKeyServers: false,  // set true before mainnet
    });

    const fileBytes = fs.readFileSync(inputPath);
    
    // The policy ID bytes are what Seal key servers use to identify
    // which seal_approve function to call on-chain
    const policyIdBytes = new TextEncoder().encode(policyId);

    const { encryptedObject, key } = await sealClient.encrypt({
        threshold: 2,           // need 2-of-N key servers to agree
        packageId: PACKAGE_ID,
        id: policyIdBytes,
        data: fileBytes,
    });

    const finalOutputPath = outputPath || (inputPath + '.sealed');
    fs.writeFileSync(finalOutputPath, Buffer.from(encryptedObject));

    // Output result as JSON for Python to parse
    console.log(JSON.stringify({
        success: true,
        output_path: finalOutputPath,
        policy_id: policyId,
        original_size: fileBytes.length,
        encrypted_size: encryptedObject.length,
    }));

} catch (err) {
    console.error(JSON.stringify({
        success: false,
        error: err.message,
    }));
    process.exit(1);
}
