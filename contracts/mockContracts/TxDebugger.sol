pragma solidity ^0.4.18;



import "../ERC20Interface.sol";
import "../KyberReserve.sol";
import "../KyberNetwork.sol";
import "../PermissionGroups.sol";
import "../WhiteList.sol";
//import "../ExpectedRateInterface.sol";
//import "../FeeBurnerInterface.sol";


contract TxDebugger is PermissionGroups{
    KyberNework public networkContract;
    function TxDebugger(address _admin, KyberNetwork network){
        require(_admin != address(0));
        require(network != address(0));
        admin = _admin;
        networkContract = network;
    }

    function debugTxValues(ERC20 token, address traderAdd, bool buy, uint qty, KyberNetwork network, uint minConversionRate) returns(string) {
        string resultStr = "";
        if (token.allowance(traderAdd, network) < srcAmount) {
            string += "Not enough token allowance";
        }
        //



    }

    function debugWhiteList(WhiteList list, address traderAdd) {



    }
    function debugReserve()
}
