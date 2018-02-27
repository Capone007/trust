const TxDebugger = artifacts.require("./mockContracts/TxDebugger.sol")
const ConversionRates = artifacts.require("./mockContracts/MockConversionRate.sol");
const TestToken = artifacts.require("./mockContracts/TestToken.sol");

let Helper = require("../test/helper.js");
let BigNumber = require('bignumber.js');

//global variables
let precisionUnits = (new BigNumber(10).pow(18));
let token;
let minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
let maxPerBlockImbalance = 4000;
let maxTotalImbalance = maxPerBlockImbalance * 2;
let admin;
let alerter;
let rateUpdateBlock;
let currentBlock = 0;
let lastSetCompactBlock = currentBlock;
let validRateDurationInBlocks = 1000;
let buys = [];
let sells = [];
let indices = [];
let baseBuy = [];
let baseSell = [];
let qtyBuyStepX = [];
let qtySellStepX = [];
let qtySellStepY = [];
let imbalance
let qtyBuyStepY = [];
let BuyStepX = [];
let imbalanceBuyStepY = [];
let imbalanceSellStepX = [];
let imbalanceSellStepY = [];
let compactBuyArr1 = [];
let compactBuyArr2 = [];
let compactSellArr1 = [];
let compactSellArr2 = [];

//contracts
let convRatesInst;
let txDebugger;
let mockReserve;
let operator;

contract('TxDebuuger', function(accounts) {
    it("should init globals", async function() {
        admin = accounts[0];
        alerter = accounts[1];
        operator = accounts[2];
        mockReserve = accounts[3];

        //should init ConversionRates Inst and set general parameters
        //init contracts
        convRatesInst = await ConversionRates.new(admin);

        //set pricing general parameters
        await convRatesInst.setValidRateDurationInBlocks(validRateDurationInBlocks);

        //create and add tokens. actually only addresses...
        token = await TestToken.new("test", "tst", 18);
        await convRatesInst.addToken(token.address);
        await convRatesInst.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
        await convRatesInst.enableTokenTrade(token.address);

        await convRatesInst.addOperator(operator);
        await convRatesInst.setReserveAddress(mockReserve);
        await convRatesInst.addAlerter(alerter);
    });

    it("should set base rates for all tokens plus compact data.", async function () {
        // set base rate

        //buy is ether to token rate. sale is token to ether rate. so sell == 1 / buy. assuming we have no spread.
        let ethToTokenRate;
        let tokenToEthRate;
        let tokens = [];
        ethToTokenRate = convertRateToPricingRate(60);
        tokenToEthRate = convertRateToPricingRate(5);
        baseBuy.push(ethToTokenRate.valueOf());
        baseSell.push(tokenToEthRate.valueOf());

        buys.length = sells.length = indices.length = 0;


        tokens.push(token.address);
        assert.equal(baseBuy.length, tokens.length);
        assert.equal(baseSell.length, tokens.length);

        currentBlock = await Helper.getCurrentBlock();
        console.log("currentBlock  " + currentBlock);
        lastSetCompactBlock = currentBlock;
        await convRatesInst.setBaseRate(tokens, baseBuy, baseSell, buys, sells, currentBlock, indices, {from: operator});

        //set compact data
        compactBuyArr1 = [1, 2, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14];
        let compactBuyHex = Helper.bytesToHex(compactBuyArr1);
        buys.push(compactBuyHex);

        compactSellArr1 = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34];
        let compactSellHex = Helper.bytesToHex(compactSellArr1);
        sells.push(compactSellHex);
        indices[0] = 0;

        assert.equal(indices.length, sells.length, "bad array size");
        assert.equal(indices.length, buys.length, "bad array size");

        await convRatesInst.setCompactData(buys, sells, currentBlock, indices, {from: operator});
        lastSetCompactBlock = currentBlock;

        //get block number from compact data and verify
        let blockNum = await convRatesInst.getRateUpdateBlock(token.address);

        assert.equal(blockNum.valueOf(), currentBlock.valueOf(), "bad block number returned");
    });

    it("should set step functions qty and imbalance.", async function () {
        qtyBuyStepX = [15, 30, 70];
        qtyBuyStepY = [8, 30, 70];
        qtySellStepX = [155, 305, 705];
        qtySellStepY = [10, 32, 78];
        imbalanceBuyStepX = [180, 330, 900, 1500];
        imbalanceBuyStepY = [35, 150, 310, 1100];
        imbalanceSellStepX = [1500, 3000, 7000, 30000];
        imbalanceSellStepY = [45, 190, 360, 1800];

        await convRatesInst.setQtyStepFunction(token.address, qtyBuyStepX, qtyBuyStepY, qtySellStepX, qtySellStepY, {from:operator});
        await convRatesInst.setImbalanceStepFunction(token.address, imbalanceBuyStepX, imbalanceBuyStepY, imbalanceSellStepX, imbalanceSellStepY, {from:operator});
    });

    it("should deploy txDebugger", async function () {
        txDebugger = await TxDebugger.new();
    });

    it("should verify when qty > max per block qty txDebugger returns rate 0 with correct reason", async function () {
        let legalQty = maxPerBlockImbalance - 1;
        let illegalQty = maxPerBlockImbalance * 1 + 1;

        debugResult = await txDebugger.debugConversionRate(convRatesInst.address, mockReserve, token.address, false, legalQty);
        assert.equal(debugResult[1].valueOf(), 0, "expected no Issue (0)" );

        debugResult = await txDebugger.debugConversionRate(convRatesInst.address, mockReserve, token.address, false, illegalQty);
        assert.equal(debugResult[1].valueOf(), 3, "expected max per block reached.");
    });

    it("should verify when total qty > max total qty txDebugger returns rate 0 with correct reason", async function () {
        let legalQty = maxPerBlockImbalance - 1;
        let qtySoFar;
        let currentBlockToSet = await Helper.getCurrentBlock() - 6;
        let rateUpdateBlockNum = await convRatesInst.getRateUpdateBlock(token.address);

        //get total imbalance in contract
        let imbalances = await convRatesInst.mockGetImbalance(token.address, lastSetCompactBlock, currentBlockToSet);
        qtySoFar = imbalances[0].valueOf();
        console.log("total imbalance: " + imbalances[0].valueOf() + "block imbalance "  + imbalances[1].valueOf());

        //record imbalance
        while (true) {
            await convRatesInst.recordImbalance(token.address, legalQty, lastSetCompactBlock, currentBlockToSet, {from: mockReserve});
            currentBlockToSet++;
            qtySoFar += 1 * legalQty;
            if (qtySoFar + legalQty > maxTotalImbalance) break;
        }
//
//
//        console.log("rate update block " + blockNum);
//        currentBlock = await Helper.getCurrentBlock();
//
//
//        imbalances = await txDebugger.getImbalance(convRatesInst.address, token.address, lastSetCompactBlock,  (currentBlock - 2));
//        console.log("total imbalance: " + imbalances[0].valueOf() + "block imbalance "  + imbalances[1].valueOf());
//
//        await convRatesInst.recordImbalance(token.address, maxPerBlockImbalance / 4, lastSetCompactBlock, (currentBlock - 1), {from: mockReserve});
//
//        //real imbalance
//        imbalances = await convRatesInst.mockGetImbalance(token.address, lastSetCompactBlock,  (currentBlock - 1));
//        console.log("total imbalance: " + imbalances[0].valueOf() + "block imbalance "  + imbalances[1].valueOf());
//
//
//        imbalances = await txDebugger.getImbalance(convRatesInst.address, token.address, lastSetCompactBlock,  (currentBlock - 1));
//        console.log("total imbalance: " + imbalances[0].valueOf() + "block imbalance "  + imbalances[1].valueOf());
//
//        await convRatesInst.recordImbalance(token.address, maxPerBlockImbalance / 4, lastSetCompactBlock, (currentBlock), {from: mockReserve});
//
//        //real imbalance
        console.log("set max total imbalamce: " + maxTotalImbalance);
        imbalances = await convRatesInst.mockGetImbalance(token.address, lastSetCompactBlock, currentBlockToSet);
        console.log("total imbalance: " + imbalances[0].valueOf() + "block imbalance "  + imbalances[1].valueOf());

        imbalances = await txDebugger.getImbalance(convRatesInst.address, token.address, lastSetCompactBlock, currentBlockToSet);
        console.log("total imbalance: " + imbalances[0].valueOf() + "block imbalance "  + imbalances[1].valueOf());

        debugResult = await txDebugger.debugConversionRate(convRatesInst.address, mockReserve, token.address, false, 1);
        assert.equal(debugResult[1].valueOf(), 0, "expected no Issue (0)" );
        console.log(" actual rate: " + debugResult[0].valueOf());

        debugResult = await txDebugger.debugConversionRate(convRatesInst.address, mockReserve, token.address, false, legalQty);
        console.log(" actual rate: " + debugResult[0].valueOf());
        assert.equal(debugResult[1].valueOf(), 2, "expected max total block reached.");
    });
});

function convertRateToPricingRate (baseRate) {
// conversion rate in pricing is in precision units (10 ** 18) so
// rate 1 to 50 is 50 * 10 ** 18
// rate 50 to 1 is 1 / 50 * 10 ** 18
    return ((new BigNumber(10).pow(18)).mul(baseRate).floor());
};

