module safeleak::safeleak {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;
    use std::string::{Self, String};

    // ── Structs ───────────────────────────────────────────────────

    /// One record per scrubbed document, shared publicly so anyone
    /// can verify the agent ran and what hashes were produced.
    public struct LeakRecord has key, store {
        id: UID,
        /// SHA-256 hex of the raw uploaded file
        original_hash: String,
        /// SHA-256 hex of the scrubbed clean file
        clean_hash: String,
        /// Walrus blob ID of the Seal-encrypted clean document
        walrus_blob_id: String,
        /// Walrus blob ID of the agent execution log (MemWal)
        agent_log_blob_id: String,
        /// Seal policy object ID controlling decryption access
        seal_policy_id: String,
        /// Who submitted (whistleblower — can submit as 0x0 for anon)
        submitter: address,
        /// Sui epoch at time of registration
        epoch: u64,
    }

    /// Capability token transferred to a journalist to prove access.
    /// Holding this cap + the Seal key = can decrypt the document.
    public struct AccessCap has key, store {
        id: UID,
        /// The LeakRecord this cap grants access to
        leak_record_id: ID,
        /// The journalist's address
        recipient: address,
        /// Granted by (whistleblower's address)
        granted_by: address,
    }

    /// Admin capability — held by the deployer, used for emergency ops
    public struct AdminCap has key, store {
        id: UID,
    }

    // ── Events ────────────────────────────────────────────────────

    public struct LeakRegistered has copy, drop {
        record_id: ID,
        original_hash: String,
        clean_hash: String,
        walrus_blob_id: String,
        agent_log_blob_id: String,
        epoch: u64,
    }

    public struct AccessGranted has copy, drop {
        record_id: ID,
        journalist: address,
        granted_by: address,
    }

    // ── Init ──────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    // ── Entry functions ───────────────────────────────────────────

    /// Called by the AI agent backend after scrubbing completes.
    /// Creates an immutable on-chain proof of the scrubbing operation.
    public entry fun register_leak(
        original_hash: vector<u8>,
        clean_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        agent_log_blob_id: vector<u8>,
        seal_policy_id: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let record = LeakRecord {
            id: object::new(ctx),
            original_hash: string::utf8(original_hash),
            clean_hash: string::utf8(clean_hash),
            walrus_blob_id: string::utf8(walrus_blob_id),
            agent_log_blob_id: string::utf8(agent_log_blob_id),
            seal_policy_id: string::utf8(seal_policy_id),
            submitter: tx_context::sender(ctx),
            epoch: tx_context::epoch(ctx),
        };

        let record_id = object::id(&record);

        event::emit(LeakRegistered {
            record_id,
            original_hash: record.original_hash,
            clean_hash: record.clean_hash,
            walrus_blob_id: record.walrus_blob_id,
            agent_log_blob_id: record.agent_log_blob_id,
            epoch: record.epoch,
        });

        // Share so journalist can read metadata without owning it
        transfer::share_object(record);
    }

    /// Whistleblower grants a journalist access to a specific leak.
    /// The journalist receives an AccessCap NFT in their wallet.
    public entry fun grant_access(
        record: &LeakRecord,
        journalist: address,
        ctx: &mut TxContext,
    ) {
        let cap = AccessCap {
            id: object::new(ctx),
            leak_record_id: object::id(record),
            recipient: journalist,
            granted_by: tx_context::sender(ctx),
        };

        event::emit(AccessGranted {
            record_id: object::id(record),
            journalist,
            granted_by: tx_context::sender(ctx),
        });

        transfer::transfer(cap, journalist);
    }

    // ── View functions ────────────────────────────────────────────

    public fun get_hashes(record: &LeakRecord): (String, String) {
        (record.original_hash, record.clean_hash)
    }

    public fun get_blob_ids(record: &LeakRecord): (String, String) {
        (record.walrus_blob_id, record.agent_log_blob_id)
    }

    public fun get_seal_policy(record: &LeakRecord): String {
        record.seal_policy_id
    }
}
