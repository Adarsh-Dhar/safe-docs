import { SealClient, EncryptedObject, SessionKey } from '@mysten/seal';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import fs from 'fs';

const [,, encryptedPath, privateKeyB64, outputPath] = process.argv;

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const RECORD_OBJECT_ID = process.env.SEAL_RECORD_OBJECT_ID;
const ACCESS_CAP_OBJECT_ID = process.env.SEAL_CAP_OBJECT_ID;
const SESSION_TTL_MIN = Number(process.env.SEAL_SESSION_TTL_MIN || '1'); // Try 1 minute

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
    const encryptedObject = EncryptedObject.parse(encryptedBytes);

    const tx = new Transaction();
    if (RECORD_OBJECT_ID && ACCESS_CAP_OBJECT_ID) {
        tx.moveCall({
            target: `${PACKAGE_ID}::seal_policy::seal_approve`,
            arguments: [
                tx.pure.vector('u8', fromHex(RECORD_OBJECT_ID)),
                tx.object(ACCESS_CAP_OBJECT_ID),
                tx.object(RECORD_OBJECT_ID),
            ],
        });
    }
    const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

    console.error(`[DEBUG] Creating session key with TTL=${SESSION_TTL_MIN} minutes`);
    const now = Date.now();
    
    const sessionKey = await SessionKey.create({
        address: keypair.getPublicKey().toSuiAddress(),
        packageId: PACKAGE_ID,
        ttlMin: SESSION_TTL_MIN,
        suiClient,
    });
    
    console.error(`[DEBUG] Session key created in ${Date.now() - now}ms`);
    console.error(`[DEBUG] Session key address: ${sessionKey.getAddress()}`);
    console.error(`[DEBUG] Session key isExpired: ${sessionKey.isExpired()}`);
    console.error(`[DEBUG] Session key toString: ${sessionKey.toString()}`);

    // Get and sign personal message
    const personalMessage = sessionKey.getPersonalMessage();
    console.error(`[DEBUG] Personal message type: ${typeof personalMessage}`);
    
    const { signature } = await keypair.signPersonalMessage(personalMessage);
    console.error(`[DEBUG] Signature length: ${signature.length}`);
    
    sessionKey.setPersonalMessageSignature(signature);
    console.error(`[DEBUG] Signature set on session key`);
    console.error(`[DEBUG] Session key after signing isExpired: ${sessionKey.isExpired()}`);

    console.error(`[DEBUG] Starting decrypt with TTL=${SESSION_TTL_MIN} min...`);
    const decryptStart = Date.now();
    
    const decryptedData = await sealClient.decrypt({
        data: encryptedBytes,
        sessionKey,
        txBytes,
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
