import { SealClient, getAllowlistedKeyServers, EncryptedObject } from '@mysten/seal';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';

/**
 * Usage: node seal_decrypt.js <encrypted_path> <sui_private_key> <output_path>
 * 
 * The journalist runs this locally with their AccessCap in their wallet.
 * Seal key servers verify they hold the cap before issuing key shares.
 */

const [,, encryptedPath, privateKeyB64, outputPath] = process.argv;

if (!encryptedPath || !privateKeyB64) {
    console.error(JSON.stringify({
        success: false,
        error: 'Usage: node seal_decrypt.js <encrypted_path> <private_key_b64> <output_path>'
    }));
    process.exit(1);
}

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;

try {
    const keypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(privateKeyB64, 'base64')
    );

    const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
    const sealClient = new SealClient({
        suiClient,
        serverObjectIds: getAllowlistedKeyServers('testnet'),
        verifyKeyServers: false,
    });

    const encryptedBytes = fs.readFileSync(encryptedPath);
    
    // Parse the encrypted object
    const encryptedObject = EncryptedObject.parse(new Uint8Array(encryptedBytes));
    
    // Fetch key shares from Seal servers — they will check seal_approve on-chain
    const decryptedData = await sealClient.decrypt({
        data: encryptedObject,
        suiClient,
        signer: keypair,
    });

    const finalOutputPath = outputPath || encryptedPath.replace('.sealed', '.decrypted');
    fs.writeFileSync(finalOutputPath, Buffer.from(decryptedData));

    console.log(JSON.stringify({
        success: true,
        output_path: finalOutputPath,
        decrypted_size: decryptedData.length,
    }));

} catch (err) {
    console.error(JSON.stringify({
        success: false,
        error: err.message,
    }));
    process.exit(1);
}
