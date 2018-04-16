var Web3 = require("web3");
var fs = require("fs");
var RLP = require('rlp');
let mainnetGasPrice = 2 * 10**9;

//  url = "https://mainnet.infura.io";
  url = 'https://semi-node.kyber.network';
const contractPath = "../contracts/";
const input = {
  "PermissionGroups.sol" : fs.readFileSync(contractPath + 'PermissionGroups.sol', 'utf8'),
  "ERC20Interface.sol" : fs.readFileSync(contractPath + 'ERC20Interface.sol', 'utf8'),
  "Utils.sol" : fs.readFileSync(contractPath + 'Utils.sol', 'utf8'),
  "KyberReserveInterface.sol" : fs.readFileSync(contractPath + 'KyberReserveInterface.sol', 'utf8'),
  "KyberReserve.sol" : fs.readFileSync(contractPath + 'KyberReserve.sol', 'utf8'),
  "Withdrawable.sol" : fs.readFileSync(contractPath + 'Withdrawable.sol', 'utf8'),
  "VolumeImbalanceRecorder.sol" : fs.readFileSync(contractPath + 'VolumeImbalanceRecorder.sol', 'utf8'),
  "DigixVirtualReserve.sol" : fs.readFileSync(contractPath + 'DigixVirtualReserve.sol', 'utf8'),
  "ConversionRatesInterface.sol" : fs.readFileSync(contractPath + 'ConversionRatesInterface.sol', 'utf8'),
  "ConversionRates.sol" : fs.readFileSync(contractPath + 'ConversionRates.sol', 'utf8'),
  "SanityRatesInterface.sol" : fs.readFileSync(contractPath + 'SanityRatesInterface.sol', 'utf8')
};

var web3 = new Web3(new Web3.providers.HttpProvider(url));
var solc = require('solc')

var rand = web3.utils.randomHex(999);
var privateKey = web3.utils.sha3("js sucks" + rand);
var privateKey = '0x5e7c21189038f99702e7960a3513ace016b14e0a8880ee0e597a4b6c8a1510a5';

var account = web3.eth.accounts.privateKeyToAccount(privateKey);
var sender = account.address;
var nonce;

console.log("from",sender);
console.log("private key");
console.log(privateKey);

async function sendTx(txObject) {
  var txTo = txObject._parent.options.address;

  var gasLimit;
  try {
    gasLimit = await txObject.estimateGas();
  }
  catch (e) {
    gasLimit = 1100 * 1000;
  }

  if(txTo !== null) {
    gasLimit =1100 * 1000;
  }

  //console.log(gasLimit);
  var txData = txObject.encodeABI();
  var txFrom = account.address;
  var txKey = account.privateKey;

  var tx = {
    from : txFrom,
    to : txTo,
    nonce : nonce,
    data : txData,
    gas : gasLimit,
    gasPrice : mainnetGasPrice
  };

  var signedTx = await web3.eth.accounts.signTransaction(tx, txKey);
  nonce++;
  // don't wait for confirmation
  web3.eth.sendSignedTransaction(signedTx.rawTransaction,{from:sender});
}

async function deployContract(solcOutput, contractName, ctorArgs) {

  var actualName = contractName;
  var bytecode = solcOutput.contracts[actualName].bytecode;

  var abi = solcOutput.contracts[actualName].interface;
  var myContract = new web3.eth.Contract(JSON.parse(abi));
  var deploy = myContract.deploy({data:"0x" + bytecode, arguments: ctorArgs});
  var address = "0x" + web3.utils.sha3(RLP.encode([sender,nonce])).slice(12).substring(14);
  address = web3.utils.toChecksumAddress(address);

  await sendTx(deploy);

  myContract.options.address = address;

  return [address,myContract];
}

async function main() {
    nonce = await web3.eth.getTransactionCount(sender);
    console.log("nonce",nonce);
    let currentBlock = await web3.eth.getBlockNumber();
    console.log("block " + currentBlock);

    console.log("starting compilation");
    var output = await solc.compile({ sources: input }, 1);
//    console.log(output);
    console.log("finished compilation");

    console.log('privateKey');
    console.log(privateKey);

    await waitForEth();

    let networkStaging = '0xD2D21FdeF0D054D2864ce328cc56D1238d6b239e';
    let kyberReserveStaging = '0x2c5a182d280eeb5824377b98cd74871f78d6b8bc';
    let digixAddress = '0x4f3AfEC4E5a3F2A6a1A411DEF7D7dFe50eE057bF';
//    let networkProduction = '0x964F35fAe36d75B1e72770e244F6595B68508CF5';

    let admin = '0xd0643bc0d0c879f175556509dbcee9373379d5c3';

    //deploy conversion rate and set all digix relevant parameters
    let ratesInst;
    let ratesAdd;
    [ratesAdd, ratesInst] = await deployContract(output, "ConversionRates.sol:ConversionRates",
            [sender]);

//ratesAdd = '0x72a1D0FCaD7b834E54453626b7b394312A9A7171';
//    let abiTxt = output.contracts["ConversionRates.sol:ConversionRates"].interface;
//    let abi = JSON.parse(abiTxt);
//    ratesInst = await new web3.eth.Contract(abi, ratesAdd);
    let operator = sender;
    await sendTx(ratesInst.methods.addOperator(admin));
    await sendTx(ratesInst.methods.addOperator(sender));
    await sendTx(ratesInst.methods.addToken(digixAddress));

    let minimalRecordResolution = 1000;
    let maxPerBlockImbalance = (web3.utils.toBN(10)).pow(web3.utils.toBN(9));
    let maxTotalImbalance = maxPerBlockImbalance.mul(web3.utils.toBN(2));
//    console.log(maxPerBlockImbalance.valueOf())
//    console.log(maxTotalImbalance.valueOf())
    await sendTx(ratesInst.methods.setTokenControlInfo(digixAddress, minimalRecordResolution, maxPerBlockImbalance.valueOf(), maxTotalImbalance.valueOf()));
    await sendTx(ratesInst.methods.enableTokenTrade(digixAddress));
    await sendTx(ratesInst.methods.setValidRateDurationInBlocks(5000));
    await sendTx(ratesInst.methods.setReserveAddress(kyberReserveStaging));

    //set rates
    let precision = (web3.utils.toBN(10)).pow(web3.utils.toBN(18));
    let tokensPerEther = precision.mul(web3.utils.toBN(7));
    let ethersPerToken = precision.div(web3.utils.toBN(7));

    let tokenAdd = [digixAddress];
    let baseBuyRate = [tokensPerEther.valueOf()];
    let baseSellRate = [ethersPerToken.valueOf()];
    let buys = [];
    let sells = [];
    let indices = [];

    await sendTx(ratesInst.methods.setBaseRate(tokenAdd, baseBuyRate, baseSellRate, buys, sells, currentBlock, indices));

    //set step functions to 0. otherwise it reverts.
    let step0 = [0];
    await sendTx(ratesInst.methods.setQtyStepFunction(digixAddress, step0, step0, step0, step0));
    await sendTx(ratesInst.methods.setImbalanceStepFunction(digixAddress, step0, step0, step0, step0));

    await sendTx(ratesInst.methods.transferAdminQuickly(admin));

    // deploy digix virtual reserve
    let digixVirtReserveAdd;
    let digixVirtReserveInst;
    //network.address, pricing.address, reserve.address, digixAdd, admin)
    [digixVirtReserveAdd,digixVirtReserveInst] = await deployContract(output, "DigixVirtualReserve.sol:DigixVirtualReserve",
        [networkStaging, ratesAdd, kyberReserveStaging, digixAddress, sender]);

//digixVirtReserveAdd = '0x1F58A138c976cEfaCE828FD9e0b82295e85E7C81';
//    abiTxt = output.contracts["DigixVirtualReserve.sol:DigixVirtualReserve"].interface;
//    abi = JSON.parse(abiTxt);
//    digixVirtReserveInst = await new web3.eth.Contract(abi, digixVirtReserveAdd);

    await sendTx(digixVirtReserveInst.methods.addOperator(admin));
    await sendTx(digixVirtReserveInst.methods.addAlerter(admin));
    await sendTx(digixVirtReserveInst.methods.setTokenControlInfo(digixAddress, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance));
    await sendTx(digixVirtReserveInst.methods.enableTrade());

    await sendTx(digixVirtReserveInst.methods.transferAdminQuickly(admin));

    console.log("digix virtual reserve", digixVirtReserveAdd);
    console.log("conversion rates add", ratesAdd);

    console.log("last nonce is", nonce);

    console.log("private key")
    console.log(privateKey);
}


function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function waitForEth() {
  while(true) {
    var balance = await web3.eth.getBalance(sender);
    console.log("waiting for balance to account " + sender);
    if(balance.toString() !== "0") {
      console.log("received " + balance.toString() + " wei");
      return;
    }
    else await sleep(10000)
  }
}

main();
