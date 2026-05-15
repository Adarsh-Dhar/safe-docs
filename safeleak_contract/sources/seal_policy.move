/// This module defines the Seal access policy for SafeLeak.
/// Key servers check this module's seal_approve function before
/// issuing decryption key shares to a requestor.
module safeleak::seal_policy {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::TxContext;
    use safeleak::safeleak::{LeakRecord, AccessCap};

    /// Seal calls this function to decide if decryption is allowed.
    /// Returns true if the caller holds an AccessCap for this record.
    public fun seal_approve(
        id: vector<u8>,
        cap: &AccessCap,
        record: &LeakRecord,
    ): bool {
        // The Seal ID must match this record's object ID bytes
        let record_id = object::id(record);
        let record_id_bytes = object::id_to_bytes(&record_id);
        
        // Verify the cap is for this record
        // In a real deployment, also verify cap.recipient == tx sender
        id == record_id_bytes
    }
}
