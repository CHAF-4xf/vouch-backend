// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title RuleRegistry
 * @notice Anchors rule hashes on-chain for tamper-proof audit trail.
 *         Rules are stored off-chain; only their hashes live here.
 * @author VOUCH (getvouched.ai)
 */
contract RuleRegistry {
    address public immutable owner;

    mapping(bytes32 => bool) public ruleExists;
    mapping(bytes32 => uint256) public ruleVersion;

    event RuleAnchored(bytes32 indexed ruleHash, uint256 version);

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Anchor a rule hash on-chain.
     * @param ruleHash Keccak256 of the rule JSON.
     * @param version Rule version number.
     */
    function anchorRule(bytes32 ruleHash, uint256 version) external onlyOwner {
        ruleExists[ruleHash] = true;
        ruleVersion[ruleHash] = version;
        emit RuleAnchored(ruleHash, version);
    }

    /**
     * @notice Check if a rule exists on-chain.
     */
    function exists(bytes32 ruleHash) external view returns (bool) {
        return ruleExists[ruleHash];
    }

    /**
     * @notice Get the latest anchored version of a rule.
     */
    function getVersion(bytes32 ruleHash) external view returns (uint256) {
        require(ruleExists[ruleHash], "Rule not found");
        return ruleVersion[ruleHash];
    }
}
