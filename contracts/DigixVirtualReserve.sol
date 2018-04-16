pragma solidity 0.4.18;


import "./ERC20Interface.sol";
import "./Utils.sol";
import "./Withdrawable.sol";
import "./SanityRatesInterface.sol";
import "./KyberReserveInterface.sol";
import "./VolumeImbalanceRecorder.sol";
import "./KyberReserve.sol";
import "./ConversionRates.sol";


/// @title Kyber Reserve contract
contract DigixVirtualReserve is KyberReserveInterface, VolumeImbalanceRecorder, Utils {

    address public kyberNetwork;
    KyberReserve public kyberReserve; //will be used as source for ethers. This reserve will not hold funds
    ConversionRates public conversionRatesContract;
    SanityRatesInterface public sanityRatesContract;
    bool public tradeEnabled;
    ERC20 public digix;
    mapping(bytes32=>bool) public approvedWithdrawAddresses; // sha3(token,address)=>bool

    function DigixVirtualReserve(
        address _kyberNetwork,
        ConversionRates _ratesContract,
        KyberReserve _kyberReserve,
        ERC20 _digix,
        address _admin
        ) public VolumeImbalanceRecorder(_admin)
    {
        require(_ratesContract != address(0));
        require(_kyberNetwork != address(0));
        require(_kyberReserve != address(0));
        require(_digix != address(0));
        kyberReserve = _kyberReserve;
        kyberNetwork = _kyberNetwork;
        conversionRatesContract = _ratesContract;
        digix = _digix;
    }

    event DepositToken(ERC20 token, uint amount);

    function() public payable {
        DepositToken(ETH_TOKEN_ADDRESS, msg.value);
    }

    event TradeExecute(
        address indexed origin,
        address src,
        uint srcAmount,
        address destToken,
        uint destAmount,
        address destAddress
    );

    function trade(
        ERC20 srcToken,
        uint srcAmount,
        ERC20 destToken,
        address destAddress,
        uint conversionRate,
        bool validate
        ) public
        payable
        returns(bool)
    {
        require(tradeEnabled);
        require(msg.sender == kyberNetwork);

        require(doTrade(srcToken, srcAmount, destToken, destAddress, conversionRate, validate));

        return true;
    }

    event TradeEnabled(bool enable);

    function enableTrade() public onlyAdmin returns(bool) {
        require(tokenControlInfo[digix].minimalRecordResolution > 0);
        tradeEnabled = true;
        TradeEnabled(true);

        return true;
    }

    function disableTrade() public onlyAlerter returns(bool) {
        tradeEnabled = false;
        TradeEnabled(false);

        return true;
    }

    event WithdrawAddressApproved(ERC20 token, address addr, bool approve);

    function approveWithdrawAddress(ERC20 token, address addr, bool approve) public onlyAdmin {
        approvedWithdrawAddresses[keccak256(token, addr)] = approve;
        WithdrawAddressApproved(token, addr, approve);

        setDecimals(token);
    }

    event WithdrawFunds(ERC20 token, uint amount, address destination);

    function withdraw(ERC20 token, uint amount, address destination) public onlyOperator returns(bool) {
        require(approvedWithdrawAddresses[keccak256(token, destination)]);

        if (token == ETH_TOKEN_ADDRESS) {
            kyberReserve.withdraw(ETH_TOKEN_ADDRESS, amount, destination);
        } else {
            //transferFrom(address _from, address _to, uint _value) public returns (bool success);
            require(token.transferFrom(kyberNetwork, destination, amount));
        }

        WithdrawFunds(token, amount, destination);

        return true;
    }

    event SetContractAddresses(address network, address rate, address sanity);

    function setContracts(
        address _kyberNetwork,
        ConversionRates _conversionRates,
        SanityRatesInterface _sanityRates
        ) public
        onlyAdmin
    {
        require(_kyberNetwork != address(0));
        require(_conversionRates != address(0));

        kyberNetwork = _kyberNetwork;
        conversionRatesContract = _conversionRates;
        sanityRatesContract = _sanityRates;

        SetContractAddresses(kyberNetwork, conversionRatesContract, sanityRatesContract);
    }

    function setKyberReserve(KyberReserve _kyberReserve) public onlyAdmin {
        require(_kyberReserve != address(0));
        kyberReserve = _kyberReserve;
    }

    ////////////////////////////////////////////////////////////////////////////
    /// status functions ///////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////
    function getBalance(ERC20 token) public view returns(uint) {
        if (token == ETH_TOKEN_ADDRESS)
            return kyberReserve.balance;
        else {
            if (token == digix) return token.balanceOf(kyberNetwork);
            else return token.balanceOf(this);
        }
    }

    function getDestQty(ERC20 src, ERC20 dest, uint srcQty, uint rate) public view returns(uint) {
        uint dstDecimals = getDecimals(dest);
        uint srcDecimals = getDecimals(src);

        return calcDstQty(srcQty, srcDecimals, dstDecimals, rate);
    }

    function getSrcQty(ERC20 src, ERC20 dest, uint dstQty, uint rate) public view returns(uint) {
        uint dstDecimals = getDecimals(dest);
        uint srcDecimals = getDecimals(src);

        return calcSrcQty(dstQty, srcDecimals, dstDecimals, rate);
    }

    function getConversionRate(ERC20 src, ERC20 dest, uint srcQty, uint blockNumber) public view returns(uint) {
        bool  buy;

        if (!tradeEnabled) return 0;

        if (ETH_TOKEN_ADDRESS == src) {
            if (dest != digix) return 0;
            buy = true;
        } else if (ETH_TOKEN_ADDRESS == dest) {
            if (src != digix) return 0;
            buy = false;
        } else {
            return 0; // pair is not listed
        }

        // check imbalance
        int totalImbalance;
        int blockImbalance;
        (totalImbalance, blockImbalance) =
            getImbalance(digix, conversionRatesContract.getRateUpdateBlock(digix), blockNumber);


        uint rate = conversionRatesContract.getRate(digix, blockNumber, buy, srcQty);
        uint destQty = getDestQty(src, dest, srcQty, rate);
        int imbalanceQty;

        // compute digix quantity for imbalance
        if (buy) {
            imbalanceQty = int(destQty);
            totalImbalance += imbalanceQty;
        } else {
            imbalanceQty = -1 * int(srcQty);
            totalImbalance += imbalanceQty;
        }

        if (abs(totalImbalance) >= getMaxTotalImbalance(digix)) return 0;
        if (abs(blockImbalance + imbalanceQty) >= getMaxPerBlockImbalance(digix)) return 0;

        if (getBalance(dest) < destQty) return 0;

        if (sanityRatesContract != address(0)) {
            uint sanityRate = sanityRatesContract.getSanityRate(src, dest);
            if (rate > sanityRate) return 0;
        }

        return rate;
    }

    /// @dev do a trade
    /// @param srcToken Src token
    /// @param srcAmount Amount of src token
    /// @param destToken Destination token
    /// @param destAddress Destination address to send tokens to
    /// @param validate If true, additional validations are applicable
    /// @return true iff trade is successful
    function doTrade(
        ERC20 srcToken,
        uint srcAmount,
        ERC20 destToken,
        address destAddress,
        uint conversionRate,
        bool validate
    )
        internal
        returns(bool)
    {
        // can skip validation if done at kyber network level
        if (validate) {
            require(conversionRate > 0);
            if (srcToken == ETH_TOKEN_ADDRESS) {
                require(destToken == digix);
                require(msg.value == srcAmount);
            } else {
                require(msg.value == 0);
                require(srcToken == digix);
            }
        }

        uint destAmount = getDestQty(srcToken, destToken, srcAmount, conversionRate);
        // sanity check
        require(destAmount > 0);

        // add to imbalance
        ERC20 token;
        int buy;
        if (srcToken == ETH_TOKEN_ADDRESS) {
            buy = int(destAmount);
            token = destToken;
        } else {
            buy = -1 * int(srcAmount);
            token = srcToken;
        }

        addImbalance(digix, buy, conversionRatesContract.getRateUpdateBlock(digix), block.number);

        // this virtual contract will not hold funds, so
        // when source is digix - leave it in kyberNetwork (don't take tokens)
        // when source is ether send it to kyberReserve
        // when dest is digix (its already in kyberNetwork
        // when dest is ether. withdraw ether from kyberReserve and send to kyberNetwork
        if (srcToken == ETH_TOKEN_ADDRESS) {
            kyberReserve.transfer(srcAmount);
        } else {
            kyberReserve.withdraw(ETH_TOKEN_ADDRESS, destAmount, kyberNetwork);
        }

        TradeExecute(msg.sender, srcToken, srcAmount, destToken, destAmount, destAddress);

        return true;
    }

    function getTokenQty(ERC20 token, uint ethQty, uint rate) internal view returns(uint) {
        uint dstDecimals = getDecimals(token);
        uint srcDecimals = ETH_DECIMALS;

        return calcDstQty(ethQty, srcDecimals, dstDecimals, rate);
    }

    function abs(int x) internal pure returns(uint) {
        if (x < 0)
            return uint(-1 * x);
        else
            return uint(x);
    }
}
