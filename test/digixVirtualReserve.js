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
let precisionUnits = (new BigNumber(10).pow(18));
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
const maxPerBlockImbalance = 4000;
const maxTotalImbalance = maxPerBlockImbalance * 12;

//base buy and sell rates (prices)
let tokensPerEther;
let ethersPerToken;
let baseBuyRate = [];
let baseSellRate = [];

//quantity buy steps
let qtyBuyStepX = [-1400, -700, -150, 0, 150, 350, 700,  1400];
let qtyBuyStepY = [ 1000,   75,   25, 0,  0, -70, -160, -3000];

//imbalance buy steps
let imbalanceBuyStepX = [-8500, -2800, -1500, 0, 1500, 2800,  4500];
let imbalanceBuyStepY = [ 1300,   130,    43, 0,   0, -110, -1600];

//sell
//sell price will be 1 / buy (assuming no spread) so sell is actually buy price in other direction
let qtySellStepX = [-1400, -700, -150, 0, 150, 350, 700, 1400];
let qtySellStepY = [-300,   -80,  -15, 0,   0, 120, 170, 3000];

//sell imbalance step
let imbalanceSellStepX = [-8500, -2800, -1500, 0, 1500, 2800,  4500];
let imbalanceSellStepY = [-1500,  -320,   -75, 0,    0,  110,   650];

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
        tokensPerEther = (new BigNumber(precisionUnits.mul(7)).floor());
        ethersPerToken = (new BigNumber(precisionUnits.div(7)).floor());
//        console.log('tokensPerEther')
//        console.log(tokensPerEther.valueOf())
//        console.log('ethersPerToken')
//        console.log(ethersPerToken.valueOf())

        tokenAdd.push(digixAdd);
        baseBuyRate.push(tokensPerEther.valueOf());
        baseSellRate.push(ethersPerToken.valueOf());

        console.log(tokenAdd)
        console.log(baseBuyRate)
        console.log(baseSellRate)
        buys.length = sells.length = indices.length = 0;

        await pricing.setBaseRate(tokenAdd, baseBuyRate, baseSellRate, buys, sells, currentBlock, indices, {from: operator});
//
//        //set compact data
//        compactBuyArr = [0, 0, 0, 0, 0, 06, 07, 08, 09, 10, 11, 12, 13, 14];
//        let compactBuyHex = Helper.bytesToHex(compactBuyArr);
//        buys.push(compactBuyHex);
//
//        compactSellArr = [0, 0, 0, 0, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34];
//        let compactSellHex = Helper.bytesToHex(compactSellArr);
//        sells.push(compactSellHex);
//
//        indices[0] = 0;

//        await pricing.setCompactData(buys, sells, currentBlock, indices, {from: operator});
    });

    it("should init network and digix virtual reserve and one 'normal' reserve, send funds to all", async function () {
        network = await Network.new(admin);
        await network.addOperator(operator);
        reserve = await Reserve.new(network.address, pricing.address, admin);
        await reserve.addAlerter(alerter);
        await pricing.setReserveAddress(reserve.address);

        //init digix virtual reserve
        // API: (address _kyberNetwork, ConversionRatesInterface _ratesContract, KyberReserveInterface _kyberReserve, address _admin
        digixVirtualReserve = await DigixVirtualReserve.new(network.address, pricing.address, reserve.address, admin);
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

//    it("get conversion rate ether to digix and verify correct.", async function (){
//        const srcQty = 100; //has no affect here
//        const block = await web3.eth.blockNumber;
//        console.log('ethAddress')
//        console.log(ethAddress)
//        console.log(ethAddress)
//        console.log('digixAdd')
//        console.log(digixAdd)
//        console.log(digixAdd)
//        let rxRate = await digixVirtualReserve.getConversionRate(ethAddress, digixAdd, srcQty, block);
//
//        assert.equal(rxRate.valueOf(), tokensPerEther.valueOf(), "bad conversion rate");
//    })

//    it("get conversion rate digix to ether and verify correct.", async function (){
//        const block = await web3.eth.blockNumber;
//        let srcQty = 100; //has no affect in digix get rate
////
////        //calculate expected rate digix to ether == digix dollar price / ether dollar price
////        let ethDollarValue = (new BigNumber(dollarsPerEtherWei)).div((new BigNumber(10)).pow(18));
////        let digixDollarValue = (new BigNumber(bid1000Digix)).div(new BigNumber(1000));
////        let expectedRate = (digixDollarValue.div(ethDollarValue)) / 1;
//
//        let rxRate = await digixReserve.getConversionRate(digix.address, ethAddress, srcQty, block);
////        rxRate = new BigNumber(rxRate.valueOf());
////        rxRate = (rxRate.div(precision)).valueOf() / 1;
//
//        assert.equal(rxRate.valueOf(), ethersPerToken.valueOf(), "bad conversion rate");
//    })
//
    it("trade ether to digix. check balances", async function () {
        let amountWei = (new BigNumber(10)).pow(15);

        //verify base rate
//        let buyRate = await network.getExpectedRate(ethAddress, digixAdd, amountWei);
//        console.log(buyRate);
//        assert.equal(buyRate[0].valueOf(), tokensPerEther.valueOf(), "unexpected rate.");
//
        let reserveStartEthbalance = await Helper.getBalancePromise(reserve.address);
        let networkStartDigixBalance = await digix.balanceOf(network.address);

        //perform trade
        await network.trade(ethAddress, amountWei, digixAdd, user2, 100, 0, walletId, {from:user1, value:amountWei});

        //check higher ether balance on reserve
        let expectedReserveEtherBalance = amountWei.add(reserveStartEthbalance);
        let balance = await Helper.getBalancePromise(reserve.address);
        assert.equal(balance.valueOf(), expectedReserveEtherBalance.valueOf(), "bad reserve balance wei");
//
//        //check token balances
//        ///////////////////////
//
//        //check token balance on user2
//        let tokenTweiBalance = await digix.balanceOf(user2);
//        let expectedTweiAmount = expectedRate.mul(amountWei).div(precisionUnits).floor();
//        assert.equal(tokenTweiBalance.valueOf(), expectedTweiAmount.valueOf(), "bad token balance");
//
//        //check lower token balance on network
//        reserve2TokenBalance[tokenInd] -= expectedTweiAmount;
//        let reportedBalance = await token.balanceOf(reserve2.address);
    });
});

function convertRateToConversionRatesRate (baseRate) {
// conversion rate in pricing is in precision units (10 ** 18) so
// rate 1 to 50 is 50 * 10 ** 18
// rate 50 to 1 is 1 / 50 * 10 ** 18 = 10 ** 18 / 50a
    return ((new BigNumber(10).pow(18)).mul(baseRate).floor());
};

function getExtraBpsForBuyQuantity(qty) {
    for (let i = 0; i < qtyBuyStepX.length; i++) {
        if (qty <= qtyBuyStepX[i]) return qtyBuyStepY[i];
    }
    return qtyBuyStepY[qtyBuyStepY.length - 1];
};

function getExtraBpsForSellQuantity(qty) {
    for (let i = 0; i < qtySellStepX.length; i++) {
        if (qty <= qtySellStepX[i]) return qtySellStepY[i];
    }
    return qtySellStepY[qtySellStepY.length - 1];
};

function getExtraBpsForImbalanceBuyQuantity(qty) {
    for (let i = 0; i < imbalanceBuyStepX.length; i++) {
        if (qty <= imbalanceBuyStepX[i]) return imbalanceBuyStepY[i];
    }
    return (imbalanceBuyStepY[imbalanceBuyStepY.length - 1]);
};

function getExtraBpsForImbalanceSellQuantity(qty) {
    for (let i = 0; i < imbalanceSellStepX.length; i++) {
        if (qty <= imbalanceSellStepX[i]) return imbalanceSellStepY[i];
    }
    return (imbalanceSellStepY[imbalanceSellStepY.length - 1]);
};

function addBps (rate, bps) {
    return (rate.mul(10000 + bps).div(10000));
};

function compareRates (receivedRate, expectedRate) {
    expectedRate = expectedRate - (expectedRate % 10);
    receivedRate = receivedRate - (receivedRate % 10);
    assert.equal(expectedRate, receivedRate, "different rates");
};
