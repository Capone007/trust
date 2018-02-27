pragma solidity ^0.4.18;



import "../ERC20Interface.sol";
import "../KyberReserve.sol";
//import "../KyberNetwork.sol";
//import "../PermissionGroups.sol";
import "../Utils.sol";
//import "../WhiteList.sol";
import "../ConversionRates.sol";
//import "../ExpectedRateInterface.sol";
//import "../FeeBurnerInterface.sol";


contract TxDebugger is Utils {
    function TxDebugger() public{   }

    uint constant internal SLIDING_WINDOW_SIZE = 5;
    uint constant internal POW_2_64 = 2 ** 64;

    enum rateZeroReason {
        noIssue,
        rateDurationExpired,
        totalImbalanceAboveMax,
        blockImbalanceAboveMax,
        reserveLackingTokens,
        highDecimalDiff
    }

    struct TokenImbalanceData {
        int  lastBlockBuyUnitsImbalance;
        uint lastBlock;

        int  totalBuyUnitsImbalance;
        uint lastRateUpdateBlock;
    }

    function debugConversionRate(ConversionRates rates, KyberReserve reserve, ERC20 token, bool isBuy, uint srcQty) public view returns(uint, uint) {
        //get rate update block
//        uint rateUpdateBlock = rates.getRateUpdateBlock(token);
//        uint validDuration = rates.validRateDurationInBlocks();
        int tokenQty;

        if (block.number >= rates.getRateUpdateBlock(token) + rates.validRateDurationInBlocks()) return (0, uint(rateZeroReason.rateDurationExpired));

        if(isDecimalsIssue(token)) return(0, uint(rateZeroReason.highDecimalDiff));

        uint minimalRecordResolution;
        uint maxPerBlockImbalance;
        uint maxTotalImbalance;

        (minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance) = rates.getTokenControlInfo(token);

        int totalImbalance;
        int currentBlockImbalance;
        (totalImbalance, currentBlockImbalance) = getImbalance(rates, token, rates.getRateUpdateBlock(token), block.number);

        if (isBuy) {
            //find rate
            tokenQty = int(calculateTokenBuyQty(rates, token, srcQty));
        } else {
            // for sell source is token
            tokenQty = -1 * int(srcQty);
        }

        totalImbalance += tokenQty;
        if(abs(tokenQty) >= maxPerBlockImbalance) return (0, uint(rateZeroReason.blockImbalanceAboveMax));
        if(abs(totalImbalance) >= maxTotalImbalance) return (0, uint(rateZeroReason.totalImbalanceAboveMax));
        if(isBuy && uint(tokenQty) > token.balanceOf(reserve)) return (0, uint(rateZeroReason.reserveLackingTokens));
        return(rates.getRate(token, block.number, isBuy, srcQty), uint(rateZeroReason.noIssue));
    }

    function calculateTokenBuyQty(ConversionRates rates, ERC20 token, uint srcQty) public view returns (uint){
        uint arrayIndex;
        uint fieldOffset;
        byte rateUpdateBuy;
        byte rateUpdateSell;

        (arrayIndex, fieldOffset, rateUpdateBuy, rateUpdateSell) = rates.getCompactData(token);

        //first calculate rate
        uint rate = rates.getBasicRate(token, true);
        rate = (rate * uint(int(1000) + int(rateUpdateBuy))) / 1000;

        uint dstDecimals = token.decimals();
        uint srcDecimals = 18;

        if (dstDecimals >= srcDecimals) {
            return (srcQty * rate * (10 ** (dstDecimals - srcDecimals))) / PRECISION;
        } else {
            return (srcQty * rate) / (PRECISION * (10 ** (srcDecimals - dstDecimals)));
        }
    }

    function isDecimalsIssue (ERC20 token) internal view returns (bool) {
        uint tokenDecimals = token.decimals();
        uint ethDecimals = 18;

        if (tokenDecimals >= ethDecimals) {
            if(tokenDecimals - ethDecimals > MAX_DECIMALS) return(true);
        } else {
            if(ethDecimals - tokenDecimals > MAX_DECIMALS) return(true);
        }

        return false;
    }

    function getImbalance(ConversionRates rates, ERC20 token, uint rateUpdateBlock, uint currentBlock)
        public view
        returns(int totalImbalance, int currentBlockImbalance)
    {
        uint minimalRecordResolution;
        uint maxPerBlockImbalance;
        uint maxTotalImbalance;

        (minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance) = rates.getTokenControlInfo(token);


        (totalImbalance, currentBlockImbalance) =
        getImbalanceSinceRateUpdate(
            rates,
            token,
            rateUpdateBlock,
            currentBlock);

        totalImbalance *= int(minimalRecordResolution);
        currentBlockImbalance *= int(minimalRecordResolution);
    }

    function getImbalanceSinceRateUpdate(ConversionRates rates, ERC20 token, uint rateUpdateBlock, uint currentBlock)
        internal view
        returns(int buyImbalance, int currentBlockImbalance)
    {
        buyImbalance = 0;
        currentBlockImbalance = 0;
        uint latestBlock = 0;
        int imbalanceInRange = 0;
        uint startBlock = rateUpdateBlock;
        uint endBlock = currentBlock;

        for (uint windowInd = 0; windowInd < SLIDING_WINDOW_SIZE; windowInd++) {
            TokenImbalanceData memory perBlockData = decodeTokenImbalanceData(rates.tokenImbalanceData(token, windowInd));

            if (perBlockData.lastBlock <= endBlock && perBlockData.lastBlock >= startBlock) {
                imbalanceInRange += perBlockData.lastBlockBuyUnitsImbalance;
            }

            if (perBlockData.lastRateUpdateBlock != rateUpdateBlock) continue;
            if (perBlockData.lastBlock < latestBlock) continue;

            latestBlock = perBlockData.lastBlock;
            buyImbalance = perBlockData.totalBuyUnitsImbalance;

            if (uint(perBlockData.lastBlock) == currentBlock) {
                currentBlockImbalance = perBlockData.lastBlockBuyUnitsImbalance;
            }
        }

        if (buyImbalance == 0) {
            buyImbalance = imbalanceInRange;
        }
    }

    function decodeTokenImbalanceData(uint input) internal pure returns(TokenImbalanceData) {
        TokenImbalanceData memory data;

        data.lastBlockBuyUnitsImbalance = int(int64(input & (POW_2_64 - 1)));
        data.lastBlock = uint(uint64((input / POW_2_64) & (POW_2_64 - 1)));
        data.totalBuyUnitsImbalance = int(int64((input / (POW_2_64 * POW_2_64)) & (POW_2_64 - 1)));
        data.lastRateUpdateBlock = uint(uint64((input / (POW_2_64 * POW_2_64 * POW_2_64))));

        return data;
    }

    function abs(int x) internal pure returns(uint) {
        if (x < 0)
            return uint(-1 * x);
        else
            return uint(x);
    }

//    function debugTxValues(ERC20 token, address traderAdd, bool buy, uint qty, KyberNetwork network, uint minConversionRate) returns(string) {
//        string resultStr = "";
//        if (token.allowance(traderAdd, network) < srcAmount) {
//            string += "Not enough token allowance";
//        }
//        //
//
//
//
//    }
//
//    function debugWhiteList(WhiteList list, address traderAdd) {
//
//
//
//    }
//    function debugReserve()
}
