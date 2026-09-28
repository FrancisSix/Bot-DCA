import { expect } from "chai";
import { ethers } from "hardhat";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const HOUR = 3600;

async function deploy() {
  const [owner, alice, keeper] = await ethers.getSigners();

  const WETH = await ethers.getContractFactory("MockERC20");
  const weth = await WETH.deploy("Wrapped BOT", "WBOT");

  const Router = await ethers.getContractFactory("MockRouter");
  const router = await Router.deploy(await weth.getAddress());

  const Token = await ethers.getContractFactory("MockERC20");
  const usdt = await Token.deploy("Tether USD", "USDT");

  const V3Router = await ethers.getContractFactory("MockV3Router");
  const v3router = await V3Router.deploy(await weth.getAddress());
  const V3Factory = await ethers.getContractFactory("MockV3Factory");
  const v3factory = await V3Factory.deploy();

  const DCA = await ethers.getContractFactory("BotDCA");
  const dca = await DCA.deploy(
    await router.getAddress(),
    await v3router.getAddress(),
    await v3factory.getAddress()
  );

  // Fund the mock V3 router so it can pay out native BOT (the real router holds inventory too).
  // Top the owner back up first so repeated deploys in one test file never run dry.
  await ethers.provider.send("hardhat_setBalance", [
    owner.address,
    ethers.toBeHex(ethers.parseEther("1000000")),
  ]);
  await owner.sendTransaction({ to: await v3router.getAddress(), value: ethers.parseEther("10000") });

  return { owner, alice, keeper, weth, router, usdt, dca, v3router, v3factory };
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("BotDCA", function () {
  it("executes ERC20 -> ERC20 DCA and accrues tokenOut (V2 venue)", async () => {
    const { alice, usdt, weth, dca } = await deploy();
    const amount = ethers.parseEther("100");
    const total = ethers.parseEther("1000");
    await usdt.mint(alice.address, total);
    await usdt.connect(alice).approve(await dca.getAddress(), total);
    await dca.setVenue(false, 3000); // V3 cannot deliver the wbot ERC-20; ERC20->ERC20 uses V2

    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), amount, HOUR, 10, 100
    );

    expect(await dca.isDue(0)).to.equal(false);
    await increaseTime(HOUR);
    expect(await dca.isDue(0)).to.equal(true);

    await dca.execute(0);
    const pos = await dca.positions(0);
    expect(pos.intervalsExecuted).to.equal(1n);
    expect(pos.accruedTokenOut).to.equal(amount);

    await dca.connect(alice).withdraw(0);
    expect(await weth.balanceOf(alice.address)).to.equal(amount);
  });

  it("executes native BOT -> USDT DCA", async () => {
    const { alice, usdt, dca } = await deploy();
    const amount = ethers.parseEther("1");
    const total = ethers.parseEther("10");

    await dca.connect(alice).createPosition(
      NATIVE, await usdt.getAddress(), amount, HOUR, 10, 100, { value: total }
    );
    await increaseTime(HOUR);
    await dca.execute(0);

    expect(await usdt.balanceOf(await dca.getAddress())).to.equal(amount);
    await dca.connect(alice).withdraw(0);
    expect(await usdt.balanceOf(alice.address)).to.equal(amount);
  });

  it("executes USDT -> native BOT DCA", async () => {
    const { alice, usdt, dca, router } = await deploy();
    const amount = ethers.parseEther("100");
    const total = ethers.parseEther("1000");
    await usdt.mint(alice.address, total);
    await usdt.connect(alice).approve(await dca.getAddress(), total);
    await alice.sendTransaction({ to: await router.getAddress(), value: ethers.parseEther("1000") });

    await dca.connect(alice).createPosition(
      await usdt.getAddress(), NATIVE, amount, HOUR, 10, 100
    );
    await increaseTime(HOUR);
    await dca.execute(0);

    const pos = await dca.positions(0);
    expect(pos.accruedTokenOut).to.equal(amount);
    await dca.connect(alice).withdraw(0);
    expect((await dca.positions(0)).accruedTokenOut).to.equal(0n);
  });

  it("cancel refunds unspent tokenIn", async () => {
    const { alice, usdt, weth, dca } = await deploy();
    const amount = ethers.parseEther("100");
    const total = ethers.parseEther("1000");
    await usdt.mint(alice.address, total);
    await usdt.connect(alice).approve(await dca.getAddress(), total);
    await dca.setVenue(false, 3000);

    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), amount, HOUR, 10, 100
    );
    await increaseTime(HOUR);
    await dca.execute(0); // 1 of 10 intervals used

    const before = await usdt.balanceOf(alice.address);
    await dca.connect(alice).cancel(0);
    const after = await usdt.balanceOf(alice.address);
    expect(after - before).to.equal(ethers.parseEther("900"));
    expect((await dca.positions(0)).active).to.equal(false);
  });

  it("reverts when not due", async () => {
    const { alice, usdt, weth, dca } = await deploy();
    await usdt.mint(alice.address, ethers.parseEther("1000"));
    await usdt.connect(alice).approve(await dca.getAddress(), ethers.parseEther("1000"));
    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), ethers.parseEther("100"), HOUR, 10, 100
    );
    await expect(dca.execute(0)).to.be.revertedWith("not due");
  });

  it("reverts when fill is below minOut (slippage protection, V2 venue)", async () => {
    const { alice, usdt, weth, dca, router } = await deploy();
    await usdt.mint(alice.address, ethers.parseEther("1000"));
    await usdt.connect(alice).approve(await dca.getAddress(), ethers.parseEther("1000"));
    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), ethers.parseEther("100"), HOUR, 10, 100
    );
    await dca.setVenue(false, 3000); // force V2 so the V2 mock router's fill rate applies
    await router.setFillRate(ethers.parseEther("0.9")); // quote 1:1, fill 0.9:1
    await increaseTime(HOUR);
    await expect(dca.execute(0)).to.be.revertedWith("slippage");
  });

  it("defaults to the V3 venue and can be switched", async () => {
    const { alice, usdt, dca } = await deploy();
    expect(await dca.useV3()).to.equal(true); // default venue is V3
    expect(await dca.v3FeeTier()).to.equal(3000);

    const amount = ethers.parseEther("1");
    const total = ethers.parseEther("10");
    // V3 default: native BOT -> USDT (V3 wraps native to WETH9 on input)
    await dca.connect(alice).createPosition(
      NATIVE, await usdt.getAddress(), amount, HOUR, 10, 100, { value: total }
    );
    await increaseTime(HOUR);
    await dca.execute(0);
    expect((await dca.positions(0)).accruedTokenOut).to.equal(amount);

    // owner can flip the venue
    await dca.setVenue(true, 500);
    expect(await dca.v3FeeTier()).to.equal(500);
  });

  it("pays keeper fee from tokenOut", async () => {
    const { alice, keeper, usdt, weth, dca } = await deploy();
    await usdt.mint(alice.address, ethers.parseEther("1000"));
    await usdt.connect(alice).approve(await dca.getAddress(), ethers.parseEther("1000"));
    await dca.setVenue(false, 3000);
    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), ethers.parseEther("100"), HOUR, 10, 100
    );
    await dca.setKeeperFeeBps(100); // 1%
    await increaseTime(HOUR);
    await dca.connect(keeper).execute(0);

    expect((await dca.positions(0)).accruedTokenOut).to.equal(ethers.parseEther("99"));
    expect(await weth.balanceOf(keeper.address)).to.equal(ethers.parseEther("1"));
  });

  it("rejects invalid create params", async () => {
    const { alice, usdt, weth, dca } = await deploy();
    await expect(
      dca.connect(alice).createPosition(
        await usdt.getAddress(), await usdt.getAddress(), ethers.parseEther("1"), HOUR, 10, 100
      )
    ).to.be.revertedWith("same token");
    await expect(
      dca.connect(alice).createPosition(
        await usdt.getAddress(), await weth.getAddress(), ethers.parseEther("1"), HOUR, 10, 5000
      )
    ).to.be.revertedWith("slippage too high");
  });

  it("supports executeWithPath and records executions", async () => {
    const { alice, usdt, weth, dca } = await deploy();
    const amount = ethers.parseEther("100");
    await usdt.mint(alice.address, ethers.parseEther("1000"));
    await usdt.connect(alice).approve(await dca.getAddress(), ethers.parseEther("1000"));

    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), amount, HOUR, 10, 100
    );
    await increaseTime(HOUR);

    await dca.executeWithPath(0, [await usdt.getAddress(), await weth.getAddress()]);

    const exs = await dca.getExecutions(0);
    expect(exs.length).to.equal(1);
    expect(exs[0].amountIn).to.equal(amount);
    expect(exs[0].amountOut).to.equal(amount);

    await expect(
      dca.executeWithPath(0, [await weth.getAddress(), await usdt.getAddress()])
    ).to.be.revertedWith("bad path");
  });
});

