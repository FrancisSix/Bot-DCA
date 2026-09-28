import { ethers } from "hardhat";

const DCA = process.env.DCA_ADDRESS ?? "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";
const ABI = [
  "function minInterval() view returns (uint256)",
  "function keeperFeeBps() view returns (uint256)",
  "function useV3() view returns (bool)",
  "function v3FeeTier() view returns (uint24)",
  "function setMinInterval(uint256)",
  "function setKeeperFeeBps(uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const dca = new ethers.Contract(DCA, ABI, signer);
  await (await dca.setMinInterval(10)).wait();
  await (await dca.setKeeperFeeBps(10)).wait();
  console.log(
    `minInterval=${(await dca.minInterval()).toString()}s keeperFeeBps=${(
      await dca.keeperFeeBps()
    ).toString()} useV3=${await dca.useV3()} v3FeeTier=${(await dca.v3FeeTier()).toString()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



