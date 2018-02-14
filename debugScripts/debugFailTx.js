//web3 modules
const Web3 = require('web3');
const fs = require('fs');
const assert = require('assert');
const solc = require('solc');

//contract sources
const contractPath = "../contracts/";

var input = {
  "ConversionRatesInterface.sol" : fs.readFileSync(contractPath + 'ConversionRatesInterface.sol', 'utf8'),
  "ConversionRates.sol" : fs.readFileSync(contractPath + 'ConversionRates.sol', 'utf8'),
  "PermissionGroups.sol" : fs.readFileSync(contractPath + 'PermissionGroups.sol', 'utf8'),
  "ERC20Interface.sol" : fs.readFileSync(contractPath + 'ERC20Interface.sol', 'utf8'),
  "MockERC20.sol" : fs.readFileSync(contractPath + 'mockContracts/MockERC20.sol', 'utf8'),
  "SanityRatesInterface.sol" : fs.readFileSync(contractPath + 'SanityRatesInterface.sol', 'utf8'),
  "ExpectedRateInterface.sol" : fs.readFileSync(contractPath + 'ExpectedRateInterface.sol', 'utf8'),
  "SanityRates.sol" : fs.readFileSync(contractPath + 'SanityRates.sol', 'utf8'),
  "ExpectedRate.sol" : fs.readFileSync(contractPath + 'ExpectedRate.sol', 'utf8'),
  "Utils.sol" : fs.readFileSync(contractPath + 'Utils.sol', 'utf8'),
  "FeeBurnerInterface.sol" : fs.readFileSync(contractPath + 'FeeBurnerInterface.sol', 'utf8'),
  "VolumeImbalanceRecorder.sol" : fs.readFileSync(contractPath + 'VolumeImbalanceRecorder.sol', 'utf8'),
  "FeeBurner.sol" : fs.readFileSync(contractPath + 'FeeBurner.sol', 'utf8'),
  "WhiteListInterface.sol" : fs.readFileSync(contractPath + 'WhiteListInterface.sol', 'utf8'),
  "KyberNetwork.sol" : fs.readFileSync(contractPath + 'KyberNetwork.sol', 'utf8'),
  "WhiteList.sol" : fs.readFileSync(contractPath + 'WhiteList.sol', 'utf8'),
  "KyberReserveInterface.sol" : fs.readFileSync(contractPath + 'KyberReserveInterface.sol', 'utf8'),
//  "Withdrawable.sol" : fs.readFileSync(contractPath + 'Withdrawable.sol', 'utf8'),
  "KyberReserve.sol" : fs.readFileSync(contractPath + 'KyberReserve.sol', 'utf8'),
};

let solcOutput;

const ethAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';


//tx values
let tokenAdd, traderAdd;
let isBuy;
let tradeQty;
let blockNumber;
let kyberNetworkAdd = "0x964F35fAe36d75B1e72770e244F6595B68508CF5";

//contract instances
let tokenInst;

//run the code
main();

async function main (){

    if (processScriptInputParameters() == false) {
        printHelp();
        return;
    }

    myLog(0, 0, "starting compilation");
    solcOutput = await solc.compile({ sources: input }, 1);
//    myLog(0, 0, solcOutput);
    myLog(0, 0, "finished compilation");

    await init(infuraUrl);
}


//functions
///////////
function processScriptInputParameters() {
    if (process.argv.length < 7) {
        myLog(0, 0, '');
        myLog(1, 0, "error: not enough argument. Required 5. Received  " + (process.argv.length - 2) + " arguments.");
        return false;
    }

    traderAdd = process.argv[2];
    if (!web3.utils.isAddress(traderAdd.toLowerCase())){
        console.log("Illegal trader address (parameter 1): " + traderAdd );
        return false;
    }
    tokenAdd = process.argv[3];
    if (!web3.utils.isAddress(tokenAdd.toLowerCase())){
        console.log("Illegal token address (parameter 2): " + tokenAdd );
        return false;
    }

    if (process.argv[4] == '0') isBuy = true;
    else isBuy = false;


    tradeQty = process.argv[5];

    if (!Number.isInteger(tradeQty)){
        console.log("Illegal tradeQty input (param 4): " + tradeQty);
        return false;
    }

    blockNumber = process.argv[6];

    if (!Number.isInteger(blockNumber)){
        console.log("Illegal blockNumber input(param 5): " + blockNumber);
        return false;
    }
}

function printHelp () {
    console.log("usage: \'node debugFailTx traderAdd tokenAdd isBuy tradeQty blockNumber\'.");
}

haveTokenInst = 0;

async function checkBalances() {
    let abi = solcOutput.contracts["MockERC20.sol:MockERC20"].interface;
    let tokenInst = await new web3.eth.Contract(JSON.parse(abi), address);


    if (isBuy) {
        let userBalance = await web3.eth.getBalance(traderAdd, blockNumber);
        assert(userBalance > tradeQty, "user balance too low");
    } else {
        let txData = await tokenInst.methods.allowance(userAddress, kyberNetworkAdd).encodeABI();
        let allowance = await web3.eth.call({to:tokenAddress, data:txData},blockNumber);
        assert(allowance >= tradeQty, "Allowance too low.");
        txData = await tokenInst.methods.balanceOf(userAddress).encodeABI();
        let balance = await web3.eth.call({to:tokenAddress, data:txData},blockNumber);
        assert(balance >= tradeQty, "Trader balance too low.");
    }
}

//var getETHBalanceWithPromise = function(userAddress, blockNumber) {
//  return new Promise(function (fulfill, reject){
//    web3.eth.getBalance(userAddress,blockNumber,function(err,result){
//      if( err ) return reject(err);
//      else {
//        return fulfill(web3.utils.toBN(result));
//      }
//    });
//  });
//};
//
//////////////////////////////////////////////////////////////////////////////////
//
//var getTokenBalanceWithPromise = function(userAddress, tokenAddress, blockNumber) {
//  return new Promise(function (fulfill, reject){
//    var tokenInstance = new web3.eth.Contract(erc20Abi,tokenAddress);
//
//    var txData = tokenInstance.methods.balanceOf(web3.utils.toChecksumAddress(userAddress)).encodeABI();
//    web3.eth.call({to:tokenAddress, data:txData},blockNumber,function(err,result){
//      if( err ) return reject(err);
//      else {
//        return fulfill(web3.utils.toBN(result));
//      }
//    });
//  });
//};


async function init(nodeUrl){
    //web3 instance

    web3 = new Web3(new Web3.providers.HttpProvider(nodeUrl));

    let goodVersion = compareVersions('1.0', web3.version);
    if (goodVersion < 0) {
        myLog(1, 0, "bad web3 version. Please install version 1.0 or higher.");
    }

    myLog(0, 0, ("web 3 version " + web3.version));
    let isListening;
    try {
        isListening = await web3.eth.net.isListening();
    } catch (e) {
        myLog(1, 0, ("can't connect to node: " + nodeUrl + ". check your internet connection. Or possibly check status of this node."));
        myLog(0, 0, ("exception: " + e));
        throw(e);
    }
    numPeers = await web3.eth.net.getPeerCount();
    myLog(0, 1, ( "node " + nodeUrl + " listening: " + isListening.toString() + " with " + numPeers + " peers"));
};
