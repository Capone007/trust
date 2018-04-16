let ConversionRates = artifacts.require("./ConversionRates.sol");
const TestFeeToken = artifacts.require("./mockContracts/TestFeeToken.sol");
let TestToken = artifacts.require("./mockContracts/TestToken.sol");
let Reserve = artifacts.require("./KyberReserve.sol");
let DigixVirtualReserve = artifacts.require("./DigixVirtualReserve.sol");
let Network = artifacts.require("./KyberNetwork.sol");
let WhiteList = artifacts.require("./WhiteList.sol");
let ExpectedRate = artifacts.require("./ExpectedRate.sol");
let FeeBurner = artifacts.require("./FeeBurner.sol");

let Helper = require("./helper.js");
let BigNumber = require('bignumber.js');

//global variables
//////////////////
let precision = (new BigNumber(10).pow(18));
let ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
let gasPrice = (new BigNumber(10).pow(9).mul(50));
let negligibleRateDiff = 15;

//balances
let expectedreserveBalanceWei = 0;
let reserveTokenBalance = [];
let reserveTokenImbalance = [];

//permission groups
let admin;
let operator;
let alerter;
let sanityRates;
let user1;
let user2;
let walletId = 0;

//contracts
let pricing;
let reserve;
let expectedRate;
let network;
let feeBurner;
let whiteList;
let digixVirtualReserve;

//block data
let priceUpdateBlock;
let currentBlock;
let validRateDurationInBlocks = 5000;

//tokens data
////////////
let digix;
let digixAdd;
let tokenAdd = [];

// imbalance data
const minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
const maxPerBlockImbalance = (new BigNumber(10)).pow(10); // 10 tokens
const maxTotalImbalance = maxPerBlockImbalance.mul(3);

//base buy and sell rates (prices)
let tokensPerEther;
let ethersPerToken;
let baseBuyRate = [];
let baseSellRate = [];

//compact data.
let sells = [];
let buys = [];
let indices = [];
let compactBuyArr = [];
let compactSellArr = [];

contract('DigixVirtualReserve', function(accounts) {
    it("should init globals. init conversionRates Inst, init digix token add to pricing inst. set basic token data.", async function () {
        // set account addresses
        admin = accounts[0];
        operator = accounts[1];
        alerter = accounts[2];
        user1 = accounts[4];
        user2 = accounts[5];

        currentBlock = priceUpdateBlock = await Helper.getCurrentBlock();

//        console.log("current block: " + currentBlock);
        //init contracts
        pricing = await ConversionRates.new(admin, {});

        //set pricing general parameters
        await pricing.setValidRateDurationInBlocks(validRateDurationInBlocks);

        //create digix and add to conversion rate contract 
        digix = await TestFeeToken.new("digix token", "DGX", 9);
        digixAdd = digix.address;
        await pricing.addToken(digixAdd);
        await pricing.setTokenControlInfo(digixAdd, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
        await pricing.enableTokenTrade(digixAdd);

        await pricing.addOperator(operator);
        
        //set rates
        tokensPerEther = (new BigNumber(precision.mul(7)).floor());
        ethersPerToken = (new BigNumber(precision.div(7)).floor());


        tokenAdd.push(digixAdd);
        baseBuyRate.push(tokensPerEther.valueOf());
        baseSellRate.push(ethersPerToken.valueOf());
        buys.length = sells.length = indices.length = 0;

        await pricing.setBaseRate(tokenAdd, baseBuyRate, baseSellRate, buys, sells, currentBlock, indices, {from: operator});

        //set step functions to 0. otherwise it reverts.
        let step0 = [0];
        await pricing.setQtyStepFunction(digixAdd, step0, step0, step0, step0, {from: operator});
        await pricing.setImbalanceStepFunction(digixAdd, step0, step0, step0, step0, {from: operator});
    });

    it("should init network and digix virtual reserve and one 'normal' reserve, send funds to all", async function () {
        network = await Network.new(admin);
        await network.addOperator(operator);
        reserve = await Reserve.new(network.address, pricing.address, admin);
        await reserve.addAlerter(alerter);
        await pricing.setReserveAddress(reserve.address);

        //init digix virtual reserve
        // API: (address _kyberNetwork, ConversionRatesInterface _ratesContract, KyberReserveInterface _kyberReserve, address _admin
        digixVirtualReserve = await DigixVirtualReserve.new(network.address, pricing.address, reserve.address, digixAdd, admin);
        await digixVirtualReserve.addOperator(operator);
        await digixVirtualReserve.addAlerter(alerter);
        await digixVirtualReserve.setTokenControlInfo(digixAdd, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
        await digixVirtualReserve.enableTrade();

        // digix reserve should be operator of reserve so it can call withdraw ethers.
        await reserve.addOperator(digixVirtualReserve.address);
        // will withdraw the ether to network. so add network as approved withdraw address
        await reserve.approveWithdrawAddress(ethAddress, network.address, true);

        //set balances. ether balance in normal reserve, digix balance in network
        let reserveEtherInit = (new BigNumber(10)).pow(19); //10**18 is 1 ether
        await Helper.sendEtherWithPromise(accounts[8], reserve.address, reserveEtherInit);

        let balance = await Helper.getBalancePromise(reserve.address);
        expectedreserveBalanceWei = balance.valueOf();
        assert.equal(balance.valueOf(), reserveEtherInit, "wrong ether balance");

        //transfer digix tokens to reserve.
        let amount = (new BigNumber(10)).pow(10); //10**9 is 1 digix
        await digix.transfer(network.address, amount.valueOf());

        //init kyber network data, list token pairs
        // add reserves
        await network.addReserve(reserve.address, true);
        await network.addReserve(digixVirtualReserve.address, true);

        //set contracts
        feeBurner = await FeeBurner.new(admin, tokenAdd[0], network.address);
        let kgtToken = await TestToken.new("kyber genesis token", "KGT", 0);
        whiteList = await WhiteList.new(admin, kgtToken.address);
        await whiteList.addOperator(operator);
        await whiteList.setCategoryCap(0, 5000, {from:operator});
        await whiteList.setSgdToEthRate(850000000000000, {from:operator});

        expectedRate = await ExpectedRate.new(network.address, admin);

        let negligibleRateDiff = 15;
        await network.setParams(whiteList.address, expectedRate.address, feeBurner.address, gasPrice.valueOf(), negligibleRateDiff);
        await network.setEnable(true);
        let price = await network.maxGasPrice();
        assert.equal(price.valueOf(), gasPrice.valueOf());

        //list digix in network.
        await network.listPairForReserve(digixVirtualReserve.address, ethAddress, digixAdd, true);
        await network.listPairForReserve(digixVirtualReserve.address, digixAdd, ethAddress, true);
    });

    it("get conversion rate digix to ether and verify correct.", async function (){
        const srcQty = 100; //has no affect here
        const block = await web3.eth.blockNumber;
        let rxRate = await digixVirtualReserve.getConversionRate(digixAdd, ethAddress, srcQty, block);
        assert.equal(rxRate.valueOf(), ethersPerToken.valueOf(), "bad conversion rate");
    })

    it("get conversion rate ether to digix and verify correct.", async function (){
        const srcQty = 100; //has no affect here
        const block = await web3.eth.blockNumber;
        let rxRate = await digixVirtualReserve.getConversionRate(ethAddress, digixAdd, srcQty, block);
        assert.equal(rxRate.valueOf(), tokensPerEther.valueOf(), "bad conversion rate");
    })

    it("get expected rate, ether to digix, from network. verify correct.", async function (){
        const qty = 100; //has no affect here
        //verify base rate
        let buyRate = await network.getExpectedRate(ethAddress, digixAdd, qty);
        assert.equal(buyRate[0].valueOf(), tokensPerEther.valueOf(), "unexpected rate.");
    })

    it("get conversion rate ether to digix and verify correct.", async function (){
        const qty = 100; //has no affect here
        //verify base rate
        let buyRate = await network.getExpectedRate(digixAdd, ethAddress, qty);
        assert.equal(buyRate[0].valueOf(), ethersPerToken.valueOf(), "unexpected rate.");
    })


    it("trade ether to digix. check balances", async function () {
        let amountWei = (new BigNumber(10)).pow(12);
        let maxDestAmount = (new BigNumber(10)).pow(15);

        //verify base rate
        let buyRate = await network.getExpectedRate(ethAddress, digixAdd, amountWei);
        assert.equal(buyRate[0].valueOf(), tokensPerEther.valueOf(), "unexpected rate.");

        //initial balances
        let reserveStartEthbalance = await Helper.getBalancePromise(reserve.address);
        let networkStartDigixBalance = await digix.balanceOf(network.address);
        let user2StartDigixBalance = await digix.balanceOf(user2);

        //perform trade
        //API: trade(src, srcAmount, dest, destAddress, maxDestAmount, minConversionRate, walletId)

        await network.trade(ethAddress, amountWei, digixAdd, user2, maxDestAmount, 0, walletId, {from:user1, value:amountWei});

        //check higher ether balance on reserve (not digix reserve which FW the amount)
        let expectedReserveEtherBalance = amountWei.add(reserveStartEthbalance);
        let balance = await Helper.getBalancePromise(reserve.address);
        assert.equal(balance.valueOf(), expectedReserveEtherBalance.valueOf(), "bad reserve balance wei");

        //check token balances
        ///////////////////////

        //check token balance on user2
        let user2DigixBalance = await digix.balanceOf(user2);
        let expectedDestQuantity = calcDstQty(amountWei, 18, 9, tokensPerEther);
        let user2ExpectedDigixBalance = user2StartDigixBalance.add(expectedDestQuantity);
        //reduce digix commision...
        user2ExpectedDigixBalance = user2ExpectedDigixBalance.mul(9987).div(10000).floor();
        assert.equal(user2DigixBalance.valueOf(), user2ExpectedDigixBalance.valueOf(), "bad token balance");

        //check lower token balance on network
        let networkDigixBalance = await digix.balanceOf(network.address);
        let expectedNetworkBalance = networkStartDigixBalance.sub(expectedDestQuantity);
        assert.equal(networkDigixBalance.valueOf(), expectedNetworkBalance.valueOf(), "bad network balance");
    });

    it("trade digix to ether. check balances", async function () {
        let maxDestAmount = (new BigNumber(10)).pow(19);
        let user2StartDigixBalance = await digix.balanceOf(user2);

        //verify base rate
        let buyRate = await network.getExpectedRate(digixAdd, ethAddress, user2StartDigixBalance);
        assert.equal(buyRate[0].valueOf(), ethersPerToken.valueOf(), "unexpected rate.");

        //initial balances
        let reserveStartEthbalance = new BigNumber(await Helper.getBalancePromise(reserve.address));
        let networkStartDigixBalance = await digix.balanceOf(network.address);

        digix.approve(network.address, user2StartDigixBalance, {from: user2});

        //perform trade
        //API: trade(src, srcAmount, dest, destAddress, maxDestAmount, minConversionRate, walletId)
        await network.trade(digixAdd, user2StartDigixBalance, ethAddress, user1, maxDestAmount, 0, walletId, {from:user2});

        let expectedDestQuantity = calcDstQty(user2StartDigixBalance, 9, 18, ethersPerToken);

        //check lower ether balance on reserve (not digix reserve which FW the amount)
        let expectedReserveEtherBalance = reserveStartEthbalance.sub(expectedDestQuantity);
        let balance = await Helper.getBalancePromise(reserve.address);
        assert.equal(balance.valueOf(), expectedReserveEtherBalance.valueOf(), "bad reserve balance wei");

        //check token balances
        ///////////////////////

        //expect zero digix for user2
        let user2DigixBalance = await digix.balanceOf(user2);
        assert.equal(user2DigixBalance.valueOf(), 0, "bad token balance");

        //check higher digix balance on network
        let networkDigixBalance = await digix.balanceOf(network.address);
        let transferValue = user2StartDigixBalance * 9987 / 10000
        let expectedNetworkBalance = networkStartDigixBalance.add(transferValue).floor();
        assert.equal(networkDigixBalance.valueOf(), expectedNetworkBalance.valueOf(), "bad network balance");
    });
});

function convertRateToConversionRatesRate (baseRate) {
// conversion rate in pricing is in precision units (10 ** 18) so
// rate 1 to 50 is 50 * 10 ** 18
// rate 50 to 1 is 1 / 50 * 10 ** 18 = 10 ** 18 / 50a
    return ((new BigNumber(10).pow(18)).mul(baseRate).floor());
};

function addBps (rate, bps) {
    return (rate.mul(10000 + bps).div(10000));
};

function calcDstQty(srcQty, srcDecimals, dstDecimals, rate) {
     if (dstDecimals >= srcDecimals) {
        return ((srcQty.mul(rate)).mul((new BigNumber(10).pow(dstDecimals - srcDecimals)))).div(precision).floor();
    } else {
        return (srcQty.mul(rate)).div(precision.mul((new BigNumber(10)).pow(srcDecimals - dstDecimals))).floor();
    }
}
