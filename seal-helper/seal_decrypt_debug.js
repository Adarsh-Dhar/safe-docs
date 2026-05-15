import { SealClient, SessionKey } from '@mysten/seal';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import fs from 'fs';

const [,, encryptedPath, privateKeyB64, outputPath] = process.argv;

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const RECORD_OBJECT_ID = process.env.SEAL_RECORD_OBJECT_ID;
const ACCESS_CAP_OBJECT_ID = process.env.SEAL_CAP_OBJECT_ID;
const SESSION_TTL_MIN = Number(process.env.SEAL_SESSION_TTL_MIN || '30'); // Maximum TTL

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

    // Build required seal_approve PTB (debug) — fail loudly if missing
    let txBytes = undefined;
    if (!PACKAGE_ID || !RECORD_OBJECT_ID || !ACCESS_CAP_OBJECT_ID) {
        console.error('[DEBUG] Missing PACKAGE_ID/RECORD_OBJECT_ID/ACCESS_CAP_OBJECT_ID — cannot build PTB');
        throw new Error('Missing PACKAGE_ID/RECORD_OBJECT_ID/ACCESS_CAP_OBJECT_ID');
    }

    try {
        console.error('[DEBUG] Building seal_approve transaction (object args)...');
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
        if (!txBytes || txBytes.length === 0) throw new Error('tx.build returned empty bytes');
        console.error(`[DEBUG] Transaction built successfully, bytes length: ${txBytes.length}`);
    } catch (txErr) {
        console.error(`[DEBUG] Failed to build seal_approve transaction: ${txErr.message}`);
        throw txErr;
    }

    console.error(`[DEBUG] Creating session key with TTL=${SESSION_TTL_MIN} minutes (with signer)`);
    const now = Date.now();
    
    // Try passing signer directly and let SDK handle signing
    const sessionKey = await SessionKey.create({
        address: keypair.getPublicKey().toSuiAddress(),
        packageId: PACKAGE_ID,
        ttlMin: SESSION_TTL_MIN,
        suiClient,
        signer: keypair,
    });
    
    console.error(`[DEBUG] Session key created in ${Date.now() - now}ms`);
    console.error(`[DEBUG] Session key address: ${sessionKey.getAddress()}`);
    console.error(`[DEBUG] Session key isExpired: ${sessionKey.isExpired()}`);
    
    // Session key is now automatically signed if signer was passed to create()
    
    console.error(`[DEBUG] Rebuilding seal_approve PTB fresh before decrypt...`);
    // Rebuild txBytes fresh right before decrypt to avoid any staleness
    const tx2 = new Transaction();
    tx2.moveCall({
        target: `${PACKAGE_ID}::seal_policy::seal_approve`,
        arguments: [
            tx2.pure.vector('u8', fromHex(RECORD_OBJECT_ID)),
            tx2.object(ACCESS_CAP_OBJECT_ID),
            tx2.object(RECORD_OBJECT_ID),
        ],
    });
    const freshTxBytes = await tx2.build({ client: suiClient, onlyTransactionKind: true });
    console.error(`[DEBUG] Fresh txBytes built, length: ${freshTxBytes.length}`);

    console.error(`[DEBUG] Starting decrypt with TTL=${SESSION_TTL_MIN} min...`);
    const decryptStart = Date.now();
    
    const decryptedData = await sealClient.decrypt({
        data: encryptedBytes,
        sessionKey,
        txBytes: freshTxBytes,
    });
    
    console.error(`[DEBUG] Decrypt completed in ${Date.now() - decryptStart}ms`);

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
