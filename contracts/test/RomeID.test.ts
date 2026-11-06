import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Keypair } from "@solana/web3.js";

const ROME_SYSTEM_PRECOMPILE = "0xFF00000000000000000000000000000000000007";

function pubkeyToBytes32Hex(pubkeyBytes: Uint8Array): string {
  return "0x" + Buffer.from(pubkeyBytes).toString("hex");
}

async function impersonateWithBalance(address: string) {
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
  await network.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]); // 100 ETH
  return ethers.getSigner(address);
}

describe("RomeID Smart Contracts Suite", function () {
  async function deployFixture() {
    const [aliceEvm, bobEvm, employer1, employer2, employer3, employer4, employer5, employer6, outsider] =
      await ethers.getSigners();

    const IdentityRegistryFactory = await ethers.getContractFactory("IdentityRegistry");
    const identityRegistry = await IdentityRegistryFactory.deploy();
    await identityRegistry.waitForDeployment();

    const WorkRegistryFactory = await ethers.getContractFactory("WorkRegistry");
    const workRegistry = await WorkRegistryFactory.deploy(await identityRegistry.getAddress());
    await workRegistry.waitForDeployment();

    const AttestationRegistryFactory = await ethers.getContractFactory("AttestationRegistry");
    const attestationRegistry = await AttestationRegistryFactory.deploy(
      await identityRegistry.getAddress(),
      await workRegistry.getAddress()
    );
    await attestationRegistry.waitForDeployment();

    // Real Solana Ed25519 keypairs simulating Phantom / Solflare users via Rome Solana lane
    const aliceSolKeypair = Keypair.generate();
    const aliceSolBytes32 = pubkeyToBytes32Hex(aliceSolKeypair.publicKey.toBytes());
    const aliceSyntheticAddr = await identityRegistry.deriveSyntheticAddress(aliceSolBytes32);
    const aliceSolanaLaneSigner = await impersonateWithBalance(aliceSyntheticAddr);

    const bobSolKeypair = Keypair.generate();
    const bobSolBytes32 = pubkeyToBytes32Hex(bobSolKeypair.publicKey.toBytes());
    const bobSyntheticAddr = await identityRegistry.deriveSyntheticAddress(bobSolBytes32);
    const bobSolanaLaneSigner = await impersonateWithBalance(bobSyntheticAddr);

    return {
      identityRegistry,
      workRegistry,
      attestationRegistry,
      aliceEvm,
      bobEvm,
      employer1,
      employer2,
      employer3,
      employer4,
      employer5,
      employer6,
      outsider,
      aliceSolKeypair,
      aliceSolBytes32,
      aliceSyntheticAddr,
      aliceSolanaLaneSigner,
      bobSolKeypair,
      bobSolBytes32,
      bobSyntheticAddr,
      bobSolanaLaneSigner,
    };
  }

  describe("1. Rome Solana-Lane Synthetic Address & SystemProgram Precompile", function () {
    it("matches @rome-protocol/sdk syntheticAddress(pubkey) byte-for-byte across 20 random Solana keypairs", async function () {
      const { identityRegistry } = await deployFixture();
      // Preserve native ESM import() under CommonJS ts-node (@rome-protocol/sdk exports "import" condition only)
      const dynamicImport = new Function("specifier", "return import(specifier)") as (
        s: string
      ) => Promise<{ syntheticAddress: (pk: unknown) => string }>;
      const { syntheticAddress } = await dynamicImport("@rome-protocol/sdk");

      for (let i = 0; i < 20; i++) {
        const kp = Keypair.generate();
        const sdkAddress = syntheticAddress(kp.publicKey).toLowerCase();
        const onChainDerived = (
          await identityRegistry.deriveSyntheticAddress(pubkeyToBytes32Hex(kp.publicKey.toBytes()))
        ).toLowerCase();
        expect(onChainDerived).to.equal(sdkAddress);
      }
    });

    it("handles Rome SystemProgram (0xFF...07) base58 conversion when precompile is absent vs etched", async function () {
      const { identityRegistry, aliceSolKeypair, aliceSolBytes32 } = await deployFixture();
      const b58 = aliceSolKeypair.publicKey.toBase58();

      // Ensure 0xFF...07 is empty first
      await network.provider.send("hardhat_setCode", [ROME_SYSTEM_PRECOMPILE, "0x"]);

      await expect(identityRegistry.solanaPubkeyToBase58(aliceSolBytes32)).to.be.revertedWithCustomError(
        identityRegistry,
        "SystemPrecompileUnavailable"
      );
      await expect(identityRegistry.base58ToSolanaPubkey(b58)).to.be.revertedWithCustomError(
        identityRegistry,
        "SystemPrecompileUnavailable"
      );

      // Etch MockRomeSystemProgram at 0xFF00000000000000000000000000000000000007
      const MockFactory = await ethers.getContractFactory("MockRomeSystemProgram");
      const mockDeployed = await MockFactory.deploy();
      await mockDeployed.waitForDeployment();
      const runtimeBytecode = await ethers.provider.getCode(await mockDeployed.getAddress());

      await network.provider.send("hardhat_setCode", [ROME_SYSTEM_PRECOMPILE, runtimeBytecode]);
      const precompileMock = MockFactory.attach(ROME_SYSTEM_PRECOMPILE) as typeof mockDeployed;
      await precompileMock.registerMapping(aliceSolBytes32, b58);

      expect(await identityRegistry.solanaPubkeyToBase58(aliceSolBytes32)).to.equal(b58);
      expect(await identityRegistry.base58ToSolanaPubkey(b58)).to.equal(aliceSolBytes32);

      // Clean up precompile code
      await network.provider.send("hardhat_setCode", [ROME_SYSTEM_PRECOMPILE, "0x"]);
    });
  });

  describe("2. IdentityRegistry — Profiles & Two-Step Dual-Lane Linking", function () {
    it("creates an EVM-owned profile, normalizes handle to lowercase, and resolves cleanly", async function () {
      const { identityRegistry, aliceEvm } = await deployFixture();

      await expect(identityRegistry.connect(aliceEvm).createProfile("Alice_Rome-01", "ipfs://alice-meta"))
        .to.emit(identityRegistry, "ProfileCreated")
        .withArgs(1n, aliceEvm.address, "alice_rome-01", "ipfs://alice-meta", ethers.ZeroHash);

      expect(await identityRegistry.totalProfiles()).to.equal(1n);
      expect(await identityRegistry.profileExists(1n)).to.equal(true);
      expect(await identityRegistry.profileExists(99n)).to.equal(false);
      expect(await identityRegistry.resolveProfile(aliceEvm.address)).to.equal(1n);

      const profile = await identityRegistry.getProfile(1n);
      expect(profile.handle).to.equal("alice_rome-01");
      expect(profile.owner).to.equal(aliceEvm.address);
      expect(profile.metadataURI).to.equal("ipfs://alice-meta");

      const byHandle = await identityRegistry.getProfileByHandle("ALICE_ROME-01");
      expect(byHandle.id).to.equal(1n);
    });

    it("creates a Solana-lane profile with verified bytes32 pubkey and rejects mismatched pubkey", async function () {
      const { identityRegistry, aliceSolanaLaneSigner, aliceSolBytes32, bobSolBytes32 } = await deployFixture();

      await expect(
        identityRegistry.connect(aliceSolanaLaneSigner).createProfileWithSolanaKey("sol_alice", "ipfs://sol", ethers.ZeroHash)
      ).to.be.revertedWithCustomError(identityRegistry, "InvalidTargetWallet");

      await expect(
        identityRegistry.connect(aliceSolanaLaneSigner).createProfileWithSolanaKey("sol_alice", "ipfs://sol", bobSolBytes32)
      ).to.be.revertedWithCustomError(identityRegistry, "SyntheticMismatch");

      await expect(
        identityRegistry
          .connect(aliceSolanaLaneSigner)
          .createProfileWithSolanaKey("Sol_Alice", "ipfs://sol", aliceSolBytes32)
      )
        .to.emit(identityRegistry, "ProfileCreated")
        .withArgs(1n, aliceSolanaLaneSigner.address, "sol_alice", "ipfs://sol", aliceSolBytes32);

      expect(await identityRegistry.resolveSolanaProfile(aliceSolBytes32)).to.equal(1n);
      expect(await identityRegistry.resolveSolanaProfile(ethers.ZeroHash)).to.equal(0n);
    });

    it("enforces handle validation, case-insensitive uniqueness, and one-profile-per-wallet", async function () {
      const { identityRegistry, aliceEvm, bobEvm } = await deployFixture();

      await expect(identityRegistry.connect(aliceEvm).createProfile("ab", "ipfs://1")).to.be.revertedWithCustomError(
        identityRegistry,
        "InvalidHandle"
      );
      await expect(
        identityRegistry.connect(aliceEvm).createProfile("a".repeat(33), "ipfs://1")
      ).to.be.revertedWithCustomError(identityRegistry, "InvalidHandle");
      await expect(
        identityRegistry.connect(aliceEvm).createProfile("bad@handle", "ipfs://1")
      ).to.be.revertedWithCustomError(identityRegistry, "InvalidHandle");

      await identityRegistry.connect(aliceEvm).createProfile("RomeBuilder", "ipfs://1");

      // Duplicate wallet
      await expect(
        identityRegistry.connect(aliceEvm).createProfile("another_handle", "ipfs://2")
      ).to.be.revertedWithCustomError(identityRegistry, "WalletAlreadyHasProfile");

      // Case-insensitive duplicate handle
      await expect(
        identityRegistry.connect(bobEvm).createProfile("romebuilder", "ipfs://2")
      ).to.be.revertedWithCustomError(identityRegistry, "HandleAlreadyTaken");

      await expect(identityRegistry.getProfile(999n)).to.be.revertedWithCustomError(
        identityRegistry,
        "ProfileNotFound"
      );
      await expect(identityRegistry.getProfileByHandle("nonexistent")).to.be.revertedWithCustomError(
        identityRegistry,
        "ProfileNotFound"
      );
      await expect(identityRegistry.getLinkedWallets(999n)).to.be.revertedWithCustomError(
        identityRegistry,
        "ProfileNotFound"
      );
    });

    it("executes full 2-step EVM -> Solana linking, shared profile control, and bidirectional unlinking", async function () {
      const {
        identityRegistry,
        aliceEvm,
        bobEvm,
        outsider,
        aliceSolBytes32,
        aliceSyntheticAddr,
        aliceSolanaLaneSigner,
        bobSolBytes32,
        bobSyntheticAddr,
        bobSolanaLaneSigner,
      } = await deployFixture();

      await identityRegistry.connect(aliceEvm).createProfile("alice", "ipfs://v1");

      // Step 1: Alice (MetaMask) requests link to her Phantom/Solflare wallet (passing ZeroAddress + bytes32 Solana pubkey)
      await expect(
        identityRegistry.connect(aliceEvm).requestLink(1n, ethers.ZeroAddress, aliceSolBytes32)
      )
        .to.emit(identityRegistry, "LinkRequested")
        .withArgs(1n, aliceEvm.address, aliceSyntheticAddr, aliceSolBytes32);

      // Pending link is NOT active yet!
      expect(await identityRegistry.resolveProfile(aliceSyntheticAddr)).to.equal(0n);
      expect(await identityRegistry.isProfileController(1n, aliceSyntheticAddr)).to.equal(false);

      let linked = await identityRegistry.getLinkedWallets(1n);
      expect(linked.length).to.equal(1);
      expect(linked[0].status).to.equal(1n); // LinkStatus.Pending

      // Duplicate link request reverts
      await expect(
        identityRegistry.connect(aliceEvm).requestLink(1n, aliceSyntheticAddr, aliceSolBytes32)
      ).to.be.revertedWithCustomError(identityRegistry, "LinkAlreadyExists");

      // Wrong wallet trying to confirm reverts
      await expect(identityRegistry.connect(outsider).confirmLink(1n)).to.be.revertedWithCustomError(
        identityRegistry,
        "NoPendingLink"
      );

      // Step 2: Alice's Solana wallet confirms from the Solana lane!
      await expect(identityRegistry.connect(aliceSolanaLaneSigner).confirmLink(1n))
        .to.emit(identityRegistry, "LinkConfirmed")
        .withArgs(1n, aliceSyntheticAddr, aliceSolBytes32);

      expect(await identityRegistry.resolveProfile(aliceSyntheticAddr)).to.equal(1n);
      expect(await identityRegistry.resolveSolanaProfile(aliceSolBytes32)).to.equal(1n);
      expect(await identityRegistry.isProfileController(1n, aliceSyntheticAddr)).to.equal(true);

      // Linked Solana wallet can now update profile metadata AND request linking another wallet!
      await expect(identityRegistry.connect(aliceSolanaLaneSigner).updateProfileMetadata(1n, "ipfs://v2-from-solana"))
        .to.emit(identityRegistry, "ProfileMetadataUpdated")
        .withArgs(1n, aliceSyntheticAddr, "ipfs://v2-from-solana");

      // Link a 3rd wallet (bobSolanaLaneSigner) to test multi-wallet swap-and-pop unlink
      await identityRegistry.connect(aliceSolanaLaneSigner).requestLink(1n, ethers.ZeroAddress, bobSolBytes32);
      await identityRegistry.connect(bobSolanaLaneSigner).confirmLink(1n);
      expect((await identityRegistry.getLinkedWallets(1n)).length).to.equal(2);

      // Outsider cannot unlink
      await expect(
        identityRegistry.connect(outsider).unlinkWallet(1n, aliceSyntheticAddr)
      ).to.be.revertedWithCustomError(identityRegistry, "NotAuthorizedToUnlink");

      // Primary owner cannot be unlinked
      await expect(
        identityRegistry.connect(aliceEvm).unlinkWallet(1n, aliceEvm.address)
      ).to.be.revertedWithCustomError(identityRegistry, "CannotUnlinkPrimaryOwner");

      // Unlink first element (swap-and-pop branch!) initiated by linked wallet itself
      await expect(identityRegistry.connect(aliceSolanaLaneSigner).unlinkWallet(1n, aliceSyntheticAddr))
        .to.emit(identityRegistry, "WalletUnlinked")
        .withArgs(1n, aliceSyntheticAddr, aliceSyntheticAddr);

      expect(await identityRegistry.resolveProfile(aliceSyntheticAddr)).to.equal(0n);
      expect(await identityRegistry.isProfileController(1n, aliceSyntheticAddr)).to.equal(false);

      // Unlink remaining element initiated by primary owner
      await expect(identityRegistry.connect(aliceEvm).unlinkWallet(1n, bobSyntheticAddr))
        .to.emit(identityRegistry, "WalletUnlinked")
        .withArgs(1n, bobSyntheticAddr, aliceEvm.address);

      expect((await identityRegistry.getLinkedWallets(1n)).length).to.equal(0);

      // Bob EVM can also test guard errors on requestLink/unlinkWallet/updateProfileMetadata
      await expect(
        identityRegistry.connect(bobEvm).updateProfileMetadata(1n, "ipfs://hack")
      ).to.be.revertedWithCustomError(identityRegistry, "NotProfileController");

      await expect(
        identityRegistry.connect(bobEvm).updateProfileMetadata(999n, "ipfs://hack")
      ).to.be.revertedWithCustomError(identityRegistry, "ProfileNotFound");

      await expect(
        identityRegistry.connect(aliceEvm).requestLink(1n, ethers.ZeroAddress, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(identityRegistry, "InvalidTargetWallet");

      await expect(
        identityRegistry.connect(aliceEvm).requestLink(1n, aliceEvm.address, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(identityRegistry, "InvalidTargetWallet");

      await expect(
        identityRegistry.connect(bobEvm).requestLink(1n, outsider.address, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(identityRegistry, "NotProfileController");

      await expect(
        identityRegistry.connect(aliceEvm).requestLink(999n, outsider.address, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(identityRegistry, "ProfileNotFound");

      await expect(identityRegistry.connect(aliceEvm).confirmLink(999n)).to.be.revertedWithCustomError(
        identityRegistry,
        "ProfileNotFound"
      );

      await expect(
        identityRegistry.connect(aliceEvm).unlinkWallet(999n, outsider.address)
      ).to.be.revertedWithCustomError(identityRegistry, "ProfileNotFound");

      await expect(
        identityRegistry.connect(aliceEvm).unlinkWallet(1n, outsider.address)
      ).to.be.revertedWithCustomError(identityRegistry, "LinkNotFound");

      // Race guard: Wallet B requested for Profile 1, then Wallet B creates Profile 2 before confirming Profile 1
      await identityRegistry.connect(aliceEvm).requestLink(1n, bobEvm.address, ethers.ZeroHash);
      await identityRegistry.connect(bobEvm).createProfile("bob_own", "ipfs://bob");
      await expect(identityRegistry.connect(bobEvm).confirmLink(1n)).to.be.revertedWithCustomError(
        identityRegistry,
        "WalletAlreadyHasProfile"
      );

      // Requesting link to a wallet that already owns Profile 2 reverts immediately
      await expect(
        identityRegistry.connect(aliceEvm).requestLink(1n, bobEvm.address, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(identityRegistry, "WalletAlreadyHasProfile");
    });
  });

  describe("3. WorkRegistry — Append-Only Portfolio Driven by Both Lanes", function () {
    it("allows both EVM owner and linked Solana wallet to add and revoke records (never deleting)", async function () {
      const {
        identityRegistry,
        workRegistry,
        aliceEvm,
        aliceSolBytes32,
        aliceSolanaLaneSigner,
        outsider,
      } = await deployFixture();

      // ZeroAddress check on deploy
      const WorkRegistryFactory = await ethers.getContractFactory("WorkRegistry");
      await expect(WorkRegistryFactory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        workRegistry,
        "ZeroAddress"
      );

      await identityRegistry.connect(aliceEvm).createProfile("alice_dev", "ipfs://alice");
      await identityRegistry.connect(aliceEvm).requestLink(1n, ethers.ZeroAddress, aliceSolBytes32);
      await identityRegistry.connect(aliceSolanaLaneSigner).confirmLink(1n);

      // Validation checks
      await expect(
        workRegistry.connect(outsider).addWorkRecord(1n, "Role", "Desc", "https://ev", 100n, 200n)
      ).to.be.revertedWithCustomError(workRegistry, "UnauthorizedProfileAction");

      await expect(
        workRegistry.connect(aliceEvm).addWorkRecord(1n, "", "Desc", "https://ev", 100n, 200n)
      ).to.be.revertedWithCustomError(workRegistry, "InvalidTitle");

      await expect(
        workRegistry.connect(aliceEvm).addWorkRecord(1n, "Title", "Desc", "https://ev", 300n, 100n)
      ).to.be.revertedWithCustomError(workRegistry, "InvalidDateRange");

      // Record #1 added from MetaMask (EVM lane)
      await expect(
        workRegistry
          .connect(aliceEvm)
          .addWorkRecord(1n, "Core Solidity Engineer", "Built Rome cross-VM ports", "https://github.com/pr/1", 1700000000n, 1710000000n)
      ).to.emit(workRegistry, "WorkRecordAdded");

      // Record #2 added from Phantom/Solflare (Solana lane) with ongoing endDate = 0
      await expect(
        workRegistry
          .connect(aliceSolanaLaneSigner)
          .addWorkRecord(1n, "Solana Runtime Contributor", "CPI optimization", "https://github.com/pr/2", 1710000000n, 0n)
      ).to.emit(workRegistry, "WorkRecordAdded");

      expect(await workRegistry.totalWorkRecords()).to.equal(2n);
      const records = await workRegistry.getProfileWorkRecords(1n);
      expect(records.length).to.equal(2);
      expect(records[1].createdBy).to.equal(aliceSolanaLaneSigner.address);

      // Revoke checks
      await expect(workRegistry.getWorkRecord(99n)).to.be.revertedWithCustomError(workRegistry, "WorkRecordNotFound");
      await expect(workRegistry.connect(outsider).revokeWorkRecord(99n)).to.be.revertedWithCustomError(
        workRegistry,
        "WorkRecordNotFound"
      );
      await expect(workRegistry.connect(outsider).revokeWorkRecord(1n)).to.be.revertedWithCustomError(
        workRegistry,
        "UnauthorizedProfileAction"
      );

      // Linked Solana wallet revokes Record #1 created by MetaMask (one shared profile!)
      await expect(workRegistry.connect(aliceSolanaLaneSigner).revokeWorkRecord(1n))
        .to.emit(workRegistry, "WorkRecordRevoked")
        .withArgs(1n, 1n, aliceSolanaLaneSigner.address);

      // Append-only: record still exists with revoked = true
      const rec1 = await workRegistry.getWorkRecord(1n);
      expect(rec1.revoked).to.equal(true);
      expect(rec1.revokedAt).to.be.greaterThan(0n);

      await expect(workRegistry.connect(aliceEvm).revokeWorkRecord(1n)).to.be.revertedWithCustomError(
        workRegistry,
        "WorkRecordAlreadyRevoked"
      );
    });
  });

  describe("4. AttestationRegistry — Employer Attestations, Uniqueness, Revocation & Reputation Math", function () {
    it("enforces attestation rules, calculates exact Reputation Score, and updates on revocation", async function () {
      const {
        identityRegistry,
        workRegistry,
        attestationRegistry,
        aliceEvm,
        bobEvm,
        employer1,
        employer2,
        employer3,
        employer4,
        employer5,
        employer6,
        aliceSolBytes32,
        aliceSolanaLaneSigner,
      } = await deployFixture();

      // Constructor ZeroAddress guards
      const AttFactory = await ethers.getContractFactory("AttestationRegistry");
      await expect(AttFactory.deploy(ethers.ZeroAddress, await workRegistry.getAddress())).to.be.revertedWithCustomError(
        attestationRegistry,
        "ZeroAddress"
      );
      await expect(
        AttFactory.deploy(await identityRegistry.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(attestationRegistry, "ZeroAddress");

      await identityRegistry.connect(aliceEvm).createProfile("alice", "ipfs://alice");
      await identityRegistry.connect(aliceEvm).requestLink(1n, ethers.ZeroAddress, aliceSolBytes32);
      await identityRegistry.connect(aliceSolanaLaneSigner).confirmLink(1n);

      await identityRegistry.connect(bobEvm).createProfile("bob", "ipfs://bob");

      await workRegistry.connect(aliceEvm).addWorkRecord(1n, "Job 1", "Desc 1", "ipfs://ev1", 100n, 200n);
      await workRegistry.connect(aliceEvm).addWorkRecord(1n, "Job 2", "Desc 2", "ipfs://ev2", 200n, 300n);
      await workRegistry.connect(bobEvm).addWorkRecord(2n, "Bob Job", "Desc B", "ipfs://evb", 100n, 200n);

      // Initial reputation = 0
      const rep0 = await attestationRegistry.getReputation(1n);
      expect(rep0.score).to.equal(0n);
      expect(rep0.activeAttestations).to.equal(0n);

      await expect(attestationRegistry.getReputation(999n)).to.be.revertedWithCustomError(
        attestationRegistry,
        "ProfileNotFound"
      );

      // Guard checks on attest()
      await expect(attestationRegistry.connect(employer1).attest(1n, 1n, 0, "ipfs://c")).to.be.revertedWithCustomError(
        attestationRegistry,
        "InvalidRating"
      );
      await expect(attestationRegistry.connect(employer1).attest(1n, 1n, 6, "ipfs://c")).to.be.revertedWithCustomError(
        attestationRegistry,
        "InvalidRating"
      );
      await expect(
        attestationRegistry.connect(employer1).attest(999n, 1n, 5, "ipfs://c")
      ).to.be.revertedWithCustomError(attestationRegistry, "ProfileNotFound");

      // Self-attestation blocked for BOTH primary EVM wallet AND linked Solana wallet!
      await expect(attestationRegistry.connect(aliceEvm).attest(1n, 1n, 5, "ipfs://c")).to.be.revertedWithCustomError(
        attestationRegistry,
        "SelfAttestationForbidden"
      );
      await expect(
        attestationRegistry.connect(aliceSolanaLaneSigner).attest(1n, 1n, 5, "ipfs://c")
      ).to.be.revertedWithCustomError(attestationRegistry, "SelfAttestationForbidden");

      // Mismatched profileId vs workRecord.profileId
      await expect(attestationRegistry.connect(employer1).attest(1n, 3n, 5, "ipfs://c")).to.be.revertedWithCustomError(
        attestationRegistry,
        "WorkRecordMismatch"
      );

      // Employer 1 attests 5 stars to Job 1
      await expect(attestationRegistry.connect(employer1).attest(1n, 1n, 5, "ipfs://great"))
        .to.emit(attestationRegistry, "AttestationCreated")
        .withArgs(1n, 1n, 1n, employer1.address, 5n, "ipfs://great");

      expect(await attestationRegistry.getActiveAttestationId(1n, employer1.address)).to.equal(1n);

      // Duplicate attestation on same record by Employer 1 reverts
      await expect(attestationRegistry.connect(employer1).attest(1n, 1n, 4, "ipfs://dup")).to.be.revertedWithCustomError(
        attestationRegistry,
        "DuplicateAttestation"
      );

      // Check Reputation after 1 attestation (rating=5, activeCount=1, distinct=1):
      // quality = 700, volume = 20, diversity = 20 => 740, avg = 500 (5.00)
      const rep1 = await attestationRegistry.getReputation(1n);
      expect(rep1.score).to.equal(740n);
      expect(rep1.averageRatingHundredths).to.equal(500n);
      expect(rep1.activeAttestations).to.equal(1n);
      expect(rep1.distinctAttesters).to.equal(1n);

      // Employer 1 ALSO attests 4 stars to Job 2 -> activeCount=2, ratingSum=9, distinctAttesters STILL 1!
      await attestationRegistry.connect(employer1).attest(1n, 2n, 4, "ipfs://good");
      const rep2 = await attestationRegistry.getReputation(1n);
      // quality = floor(9 * 140 / 2) = 630, volume = 40, diversity = 20 => 690, avg = 450
      expect(rep2.score).to.equal(690n);
      expect(rep2.averageRatingHundredths).to.equal(450n);
      expect(rep2.activeAttestations).to.equal(2n);
      expect(rep2.distinctAttesters).to.equal(1n);

      // Employer 2 attests 5 stars to Job 1 -> activeCount=3, ratingSum=14, distinctAttesters=2
      await attestationRegistry.connect(employer2).attest(1n, 1n, 5, "ipfs://top");
      const rep3 = await attestationRegistry.getReputation(1n);
      // quality = floor(14 * 140 / 3) = 653, volume = 60, diversity = 40 => 753, avg = 466
      expect(rep3.score).to.equal(753n);
      expect(rep3.averageRatingHundredths).to.equal(466n);
      expect(rep3.distinctAttesters).to.equal(2n);

      // Revocation guard checks
      await expect(attestationRegistry.getAttestation(999n)).to.be.revertedWithCustomError(
        attestationRegistry,
        "AttestationNotFound"
      );
      await expect(attestationRegistry.connect(employer1).revokeAttestation(999n)).to.be.revertedWithCustomError(
        attestationRegistry,
        "AttestationNotFound"
      );
      await expect(attestationRegistry.connect(employer2).revokeAttestation(1n)).to.be.revertedWithCustomError(
        attestationRegistry,
        "NotOriginalAttester"
      );

      // Employer 1 revokes Attestation #2 (still has Attestation #1 active, so distinctAttesters stays 2!)
      await expect(attestationRegistry.connect(employer1).revokeAttestation(2n))
        .to.emit(attestationRegistry, "AttestationRevoked")
        .withArgs(2n, 1n, 2n, employer1.address);

      await expect(attestationRegistry.connect(employer1).revokeAttestation(2n)).to.be.revertedWithCustomError(
        attestationRegistry,
        "AttestationAlreadyRevoked"
      );

      const repAfterRevoke1 = await attestationRegistry.getReputation(1n);
      // activeCount=2 (5 + 5 = 10), distinct=2 => quality=700, volume=40, diversity=40 => 780
      expect(repAfterRevoke1.score).to.equal(780n);
      expect(repAfterRevoke1.distinctAttesters).to.equal(2n);

      // Employer 1 revokes Attestation #1 (their last active attestation -> distinctAttesters drops to 1!)
      await attestationRegistry.connect(employer1).revokeAttestation(1n);
      const repAfterRevokeAllEmp1 = await attestationRegistry.getReputation(1n);
      expect(repAfterRevokeAllEmp1.activeAttestations).to.equal(1n);
      expect(repAfterRevokeAllEmp1.distinctAttesters).to.equal(1n);
      expect(repAfterRevokeAllEmp1.score).to.equal(740n);

      // Revoking a work record blocks new attestations on it
      await workRegistry.connect(aliceEvm).revokeWorkRecord(2n);
      await expect(attestationRegistry.connect(employer3).attest(1n, 2n, 5, "ipfs://late")).to.be.revertedWithCustomError(
        attestationRegistry,
        "CannotAttestRevokedWorkRecord"
      );

      // Test volume & diversity saturation caps (>10 attestations and >5 distinct attesters => max 1000)
      await workRegistry.connect(aliceEvm).addWorkRecord(1n, "Job 3", "Desc 3", "ipfs://ev3", 300n, 400n); // id 4
      const employers = [employer1, employer2, employer3, employer4, employer5, employer6];
      for (const emp of employers) {
        if ((await attestationRegistry.getActiveAttestationId(1n, emp.address)) === 0n) {
          await attestationRegistry.connect(emp).attest(1n, 1n, 5, "ipfs://5star");
        }
        await attestationRegistry.connect(emp).attest(1n, 4n, 5, "ipfs://5star-job3");
      }

      const repMax = await attestationRegistry.getReputation(1n);
      expect(repMax.activeAttestations).to.equal(12n);
      expect(repMax.distinctAttesters).to.equal(6n);
      expect(repMax.score).to.equal(1000n);

      expect((await attestationRegistry.getProfileAttestations(1n)).length).to.be.greaterThanOrEqual(12);
      expect((await attestationRegistry.getWorkRecordAttestations(1n)).length).to.be.greaterThanOrEqual(6);
      expect(await attestationRegistry.totalAttestations()).to.be.greaterThanOrEqual(12n);
    });
  });
});
