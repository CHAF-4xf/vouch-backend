// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title VouchRegistry
 * @notice Stores cryptographic proofs of AI agent decisions on-chain.
 *         Uses Merkle batching: many proofs → one tx.
 * @author VOUCH (getvouched.ai)
 */
contract VouchRegistry {
    address public immutable owner;

    struct Batch {
        bytes32 merkleRoot;
        uint256 proofCount;
        uint256 timestamp;
    }

    // Individual proof existence (direct lookup)
    mapping(bytes32 => bool) public proofExists;

    // Batch records
    uint256 public batchCount;
    mapping(uint256 => Batch) public batches;

    // Events
    event BatchRegistered(
        uint256 indexed batchId,
        bytes32 merkleRoot,
        uint256 proofCount
    );
    event ProofRegistered(bytes32 indexed proofHash);

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Register a batch of proofs via Merkle root + individual hashes.
     * @param merkleRoot Root of the Merkle tree containing all proof hashes.
     * @param proofCount Number of proofs in this batch.
     * @param proofHashes Array of individual proof hashes for direct lookup.
     */
    function registerBatch(
        bytes32 merkleRoot,
        uint256 proofCount,
        bytes32[] calldata proofHashes
    ) external onlyOwner {
        require(proofHashes.length == proofCount, "Count mismatch");
        require(proofCount > 0, "Empty batch");
        require(proofCount <= 500, "Batch too large");

        uint256 batchId = batchCount++;

        batches[batchId] = Batch({
            merkleRoot: merkleRoot,
            proofCount: proofCount,
            timestamp: block.timestamp
        });

        for (uint256 i = 0; i < proofHashes.length; i++) {
            require(!proofExists[proofHashes[i]], "Duplicate proof");
            proofExists[proofHashes[i]] = true;
            emit ProofRegistered(proofHashes[i]);
        }

        emit BatchRegistered(batchId, merkleRoot, proofCount);
    }

    /**
     * @notice Check if a proof has been registered (view only).
     */
    function exists(bytes32 proofHash) external view returns (bool) {
        return proofExists[proofHash];
    }

    /**
     * @notice Verify that a proof is included in a specific batch via Merkle proof.
     * @param proofHash The proof hash to verify.
     * @param merkleProof The Merkle inclusion proof path.
     * @param batchId The batch to verify against.
     */
    function verifyInclusion(
        bytes32 proofHash,
        bytes32[] calldata merkleProof,
        uint256 batchId
    ) external view returns (bool) {
        require(batchId < batchCount, "Batch not found");
        bytes32 root = batches[batchId].merkleRoot;

        bytes32 leaf = proofHash;
        for (uint256 i = 0; i < merkleProof.length; i++) {
            if (leaf <= merkleProof[i]) {
                leaf = keccak256(abi.encodePacked(leaf, merkleProof[i]));
            } else {
                leaf = keccak256(abi.encodePacked(merkleProof[i], leaf));
            }
        }

        return leaf == root;
    }

    /**
     * @notice Get batch details.
     */
    function getBatch(uint256 batchId) external view returns (
        bytes32 merkleRoot,
        uint256 proofCount,
        uint256 timestamp
    ) {
        require(batchId < batchCount, "Batch not found");
        Batch storage b = batches[batchId];
        return (b.merkleRoot, b.proofCount, b.timestamp);
    }
}
