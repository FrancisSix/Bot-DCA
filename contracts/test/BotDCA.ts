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

  const DCA = await ethers.getContractFactory("BotDCA");
  const dca = await DCA.deploy(await router.getAddress());

  return { owner, alice, keeper, weth, router, usdt, dca };
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("BotDCA", function () {
  it("executes ERC20 -> ERC20 DCA and accrues tokenOut", async () => {
    const { alice, usdt, weth, dca } = await deploy();
    const amount = ethers.parseEther("100");
    const total = ethers.parseEther("1000");
    await usdt.mint(alice.address, total);
    await usdt.connect(alice).approve(await dca.getAddress(), total);

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

  it("reverts when fill is below minOut (slippage protection)", async () => {
    const { alice, usdt, weth, dca, router } = await deploy();
    await usdt.mint(alice.address, ethers.parseEther("1000"));
    await usdt.connect(alice).approve(await dca.getAddress(), ethers.parseEther("1000"));
    await dca.connect(alice).createPosition(
      await usdt.getAddress(), await weth.getAddress(), ethers.parseEther("100"), HOUR, 10, 100
    );
    await router.setFillRate(ethers.parseEther("0.9")); // quote 1:1, fill 0.9:1
    await increaseTime(HOUR);
    await expect(dca.execute(0)).to.be.revertedWith("slippage");
  });

  it("pays keeper fee from tokenOut", async () => {
    const { alice, keeper, usdt, weth, dca } = await deploy();
    await usdt.mint(alice.address, ethers.parseEther("1000"));
    await usdt.connect(alice).approve(await dca.getAddress(), ethers.parseEther("1000"));
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

