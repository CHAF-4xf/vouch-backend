// ═══════════════════════════════════════════
// VOUCH Batch Proof Job
// Runs on cron: batches proofs → Merkle root → on-chain tx
// ═══════════════════════════════════════════

import 'dotenv/config';
import { query } from '../db';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils';
import { ethers } from 'ethers';

const BATCH_MAX = parseInt(process.env.BATCH_MAX_SIZE || '500');

// ─── Merkle Tree ─────────────────────────

function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) throw new Error('No leaves');
  if (leaves.length === 1) return leaves[0];

  // Convert to bytes32
  let layer = leaves.map(l => hexToBytes(l.slice(2)));

  while (layer.length > 1) {
    const nextLayer: Uint8Array[] = [];

    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        // Sort pair for consistent ordering
        const [a, b] = bytesToHex(layer[i]) <= bytesToHex(layer[i + 1])
          ? [layer[i], layer[i + 1]]
          : [layer[i + 1], layer[i]];

        const combined = new Uint8Array(64);
        combined.set(a, 0);
        combined.set(b, 32);
        nextLayer.push(keccak256(combined));
      } else {
        // Odd leaf: promote to next level
        nextLayer.push(layer[i]);
      }
    }

    layer = nextLayer;
  }

  return '0x' + bytesToHex(layer[0]);
}

// ─── Batch Job ───────────────────────────

export async function batchProofsToChain() {
  console.log('[batch] Starting proof batch job...');

  // 1. Fetch unbatched proofs
  const unbatched = await query<{ id: string; proof_hash: string }>(
    `SELECT id, proof_hash FROM proofs
     WHERE on_chain_tx_hash IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [BATCH_MAX]
  );

  if (unbatched.length === 0) {
    console.log('[batch] No unbatched proofs. Skipping.');
    return;
  }

  console.log(`[batch] Found ${unbatched.length} proofs to batch.`);

  // 2. Compute Merkle root
  const leaves = unbatched.map(p => p.proof_hash);
  const merkleRoot = computeMerkleRoot(leaves);
  console.log(`[batch] Merkle root: ${merkleRoot}`);

  // 3. Submit on-chain (if RPC + contract configured)
  const rpcUrl = process.env.RPC_URL;
  const contractAddr = process.env.REGISTRY_CONTRACT_ADDRESS;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl || !contractAddr || !deployerKey) {
    console.log('[batch] Blockchain not configured. Skipping on-chain registration.');
    console.log('[batch] Set RPC_URL, REGISTRY_CONTRACT_ADDRESS, and DEPLOYER_PRIVATE_KEY to enable.');
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(deployerKey, provider);

    const abi = [
      'function registerBatch(bytes32 merkleRoot, uint256 proofCount, bytes32[] calldata proofHashes) external',
    ];
    const contract = new ethers.Contract(contractAddr, abi, wallet);

    const tx = await contract.registerBatch(
      merkleRoot,
      unbatched.length,
      leaves
    );

    console.log(`[batch] Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[batch] Tx confirmed in block ${receipt.blockNumber}`);

    // 4. Update all proofs with tx hash
    const ids = unbatched.map(p => p.id);
    await query(
      `UPDATE proofs SET on_chain_tx_hash = $1
       WHERE id = ANY($2::uuid[])`,
      [tx.hash, ids]
    );

    console.log(`[batch] Updated ${ids.length} proofs with tx hash.`);
  } catch (err: any) {
    console.error(`[batch] On-chain registration failed: ${err.message}`);
    // Don't throw — proofs are still valid off-chain. Retry next batch.
  }
}

// Run directly if called as script
if (require.main === module) {
  batchProofsToChain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
