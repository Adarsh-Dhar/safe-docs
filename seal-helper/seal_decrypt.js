import { SealClient, SessionKey } from '@mysten/seal';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
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
const RECORD_OBJECT_ID = process.env.SEAL_RECORD_OBJECT_ID;
const ACCESS_CAP_OBJECT_ID = process.env.SEAL_CAP_OBJECT_ID;
const SESSION_TTL_MIN = Number(process.env.SEAL_SESSION_TTL_MIN || '30');

try {
    const keypair = privateKeyB64.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(privateKeyB64)
        : Ed25519Keypair.fromSecretKey(Buffer.from(privateKeyB64, 'base64'));
    const suiClient = new SuiJsonRpcClient({
        url: getJsonRpcFullnodeUrl('testnet'),
        network: 'testnet',
    });

    const sealClient = new SealClient({
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

    const encryptedBytes = Uint8Array.from(fs.readFileSync(encryptedPath));

    // Build required seal_approve PTB and require txBytes (no silent fallback)
    let txBytes = undefined;
    if (!PACKAGE_ID || !RECORD_OBJECT_ID || !ACCESS_CAP_OBJECT_ID) {
        throw new Error('Missing PACKAGE_ID, RECORD_OBJECT_ID, or ACCESS_CAP_OBJECT_ID — cannot build PTB');
    }

    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::seal_policy::seal_approve`,
        arguments: [
            tx.pure.vector('u8', fromHex(RECORD_OBJECT_ID)),
            tx.object(ACCESS_CAP_OBJECT_ID),
            tx.object(RECORD_OBJECT_ID),
        ],
    });
    txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
    if (!txBytes || txBytes.length === 0) {
        throw new Error('Failed to build seal_approve transaction bytes — txBytes empty');
    }

    // Create session key (do NOT pass signer here - we'll sign the personal message explicitly)
    const sessionKey = await SessionKey.create({
        address: keypair.getPublicKey().toSuiAddress(),
        packageId: PACKAGE_ID,
        ttlMin: SESSION_TTL_MIN,
        suiClient,
    });

    // CRITICAL: Session key must be signed before use
    // Get the personal message that needs to be signed (synchronous call)
    const personalMessage = sessionKey.getPersonalMessage();
    
    // Sign the personal message with the keypair and pass raw signature bytes
    const signRes = await keypair.signPersonalMessage(personalMessage);
    const signature = signRes?.signature || signRes;
    sessionKey.setPersonalMessageSignature(signature);

    const decryptedData = await sealClient.decrypt({
        data: encryptedBytes,
        sessionKey,
        txBytes,
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
