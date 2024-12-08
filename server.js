const express = require('express');
const { RequestNetwork, Types, Utils } = require('@requestnetwork/request-client.js');
const { EthereumPrivateKeySignatureProvider } = require('@requestnetwork/epk-signature');
const { config } = require('dotenv');
const { Wallet, utils } = require('ethers');
const app = express();
const cors = require('cors');

config();

// Sepolia Contract Addresses
const FAU_TOKEN_ADDRESS = '0x370DE27fdb7D1Ff1e1BaA7D11c5820a324Cf623C';
const ERC20_FEE_PROXY_ADDRESS = '0x399F5EE127ce7432E4921a61b8CF52b0af52cbfE';

app.use(express.json());
app.use(cors());

const epkSignatureProvider = new EthereumPrivateKeySignatureProvider({
  method: Types.Signature.METHOD.ECDSA,
  privateKey: process.env.PAYEE_PRIVATE_KEY,
});

const requestClient = new RequestNetwork({
  nodeConnectionConfig: {
    baseURL: 'https://sepolia.gateway.request.network/',
  },
  signatureProvider: epkSignatureProvider,
});

app.post('/create-invoice', async (req, res) => {
  const { address, reason, dueDate } = req.body;

  try {
    const payeeIdentity = new Wallet(process.env.PAYEE_PRIVATE_KEY).address;
    const payerIdentity = address;
    const paymentRecipient = payeeIdentity;
    const feeRecipient = '0x0000000000000000000000000000000000000000';

    const requestCreateParameters = {
      requestInfo: {
        currency: {
          type: Types.RequestLogic.CURRENCY.ERC20,
          value: FAU_TOKEN_ADDRESS,
          network: 'sepolia',
        },
        expectedAmount: '1000000000000000000', // 1 FAU token
        payee: {
          type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
          value: payeeIdentity,
        },
        payer: {
          type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
          value: payerIdentity,
        },
        timestamp: Utils.getCurrentTimestampInSecond(),
      },
      paymentNetwork: {
        id: Types.Extension.PAYMENT_NETWORK_ID.ERC20_FEE_PROXY_CONTRACT,
        parameters: {
          paymentAddress: paymentRecipient,
          feeAddress: feeRecipient,
          feeAmount: '0',
        },
      },
      contentData: {
        reason: reason,
        dueDate: dueDate,
      },
      signer: {
        type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
        value: payeeIdentity,
      },
    };

    const request = await requestClient.createRequest(requestCreateParameters);
    const requestData = await request.waitForConfirmation();
    
    res.json({
      requestId: requestData.requestId,
      payeeIdentity: requestData.creator.value,
      expectedAmount: requestCreateParameters.requestInfo.expectedAmount,
      contentData: requestData.contentData,
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({
      error: 'Failed to create invoice',
      details: error.message
    });
  }
});

app.post('/process-payment', async (req, res) => {
  const { requestId, payerAddress } = req.body;

  try {
    console.log('Processing payment for request:', requestId);
    
    const request = await requestClient.fromRequestId(requestId);
    const requestData = await request.getData();
    
    console.log('Request data:', requestData);

    if (!requestData) {
      throw new Error('Request not found');
    }

    // Get payment network data
    const paymentNetwork = requestData.extensions[Types.Extension.PAYMENT_NETWORK_ID.ERC20_FEE_PROXY_CONTRACT];
    
    if (!paymentNetwork) {
      throw new Error('Payment network not configured for this request');
    }

    // Create the payment reference
    const salt = paymentNetwork.values.salt;
    const paymentReference = utils.solidityKeccak256(
      ['string', 'string', 'address', 'uint256'],
      [requestId, salt, payerAddress, requestData.expectedAmount]
    );

    // Create the payment data
    const abiEncoded = utils.defaultAbiCoder.encode(
      ['string', 'string', 'address', 'uint256'],
      [requestId, salt, payerAddress, requestData.expectedAmount]
    );

    res.json({
      tokenAddress: FAU_TOKEN_ADDRESS,
      paymentProxyAddress: ERC20_FEE_PROXY_ADDRESS,
      expectedAmount: requestData.expectedAmount,
      paymentReference: paymentReference,
      paymentData: abiEncoded
    });

  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({
      error: 'Failed to process payment',
      details: error.message
    });
  }
});

app.listen(3002, () => {
  console.log('Server running on http://localhost:3002');
});